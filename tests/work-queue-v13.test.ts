import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { rankUnifiedQueue } from '../packages/contracts/work-queue.js';

const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};

test('V13 Work Queue persists only confirmed manual work and preserves business projections',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'work-queue-v13-')),{app,store}=await createApp(directory);t.after(()=>app.close());
  assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 16);
  assert.ok(readdirSync(directory).some(name=>name.startsWith('before-work-queue-v13-')));
  const categories=await app.inject({method:'GET',url:'/api/categories',headers});
  const category=categories.json().find((item:{code:string})=>item.code==='shampoo');
  const project=await app.inject({method:'POST',url:'/api/product-projects',headers,payload:{projectType:'NEW_PRODUCT',categoryId:category.id,name:'工作队列测试项目',objective:'验证指派任务',positioning:'洗护',constraints:[],notes:''}});
  assert.equal(project.statusCode,201,project.body);
  const projectId=project.json().project.id;
  const before=await app.inject({method:'GET',url:'/api/work-queue',headers});
  assert.ok(before.json().attention.some((item:{id:string})=>item.id===`project:${projectId}`));
  const key=randomUUID(),payload={title:'明天前核对产品定义',source:'MANAGER_ASSIGNED',priority:'HIGH',deadline:new Date(Date.now()+20*3600000).toISOString(),objective:'确认项目下一步',acceptanceCriteria:['核对项目资料','记录结论'],relatedEntityType:'PROJECT',relatedEntityId:projectId};
  const created=await app.inject({method:'POST',url:'/api/work-queue/manual',headers:{...headers,'idempotency-key':key},payload});
  assert.equal(created.statusCode,201,created.body);
  const repeated=await app.inject({method:'POST',url:'/api/work-queue/manual',headers:{...headers,'idempotency-key':key},payload});
  assert.equal(repeated.statusCode,200,repeated.body);
  assert.equal(repeated.json().id,created.json().id);
  assert.equal(store.db.prepare('SELECT count(*) n FROM manual_work_items').get()!.n,1);
  const queue=await app.inject({method:'GET',url:'/api/work-queue',headers});
  const manual=queue.json().attention.find((item:{manualTaskId?:string})=>item.manualTaskId===created.json().id);
  assert.equal(manual.source,'MANAGER_ASSIGNED');
  assert.equal(manual.target.projectId,projectId);
  assert.ok(manual.rankingReasons.includes('24 小时内截止'));
  assert.ok(queue.json().attention.some((item:{id:string})=>item.id===`project:${projectId}`));
  const done=await app.inject({method:'PATCH',url:`/api/work-queue/manual/${created.json().id}`,headers,payload:{status:'COMPLETED'}});
  assert.equal(done.statusCode,200);
  const after=await app.inject({method:'GET',url:'/api/work-queue',headers});
  assert.ok(!after.json().attention.some((item:{manualTaskId?:string})=>item.manualTaskId===created.json().id));
  assert.ok(after.json().attention.some((item:{id:string})=>item.id===`project:${projectId}`));
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('explicit priority, deadline and business blocking are combined; assignment is not always first',()=>{
  const now='2026-09-29T12:00:00.000Z';
  const manual={id:randomUUID(),title:'低优先级指派',source:'MANAGER_ASSIGNED' as const,priority:'LOW' as const,deadline:null,objective:'核对',acceptanceCriteria:['确认'],relatedEntityType:'PROJECT' as const,relatedEntityId:randomUUID(),status:'OPEN' as const,target:{view:'projects' as const},createdAt:now,updatedAt:now};
  const projected={id:'opportunity:review',kind:'opportunity' as const,title:'审核机会',context:'研究',reason:'机会待审核',status:'待审核',action:'审核',target:{view:'market' as const},priority:100};
  assert.equal(rankUnifiedQueue([projected],[manual],now)[0]?.id,'opportunity:review');
  const urgentAssignment={...manual,id:randomUUID(),title:'明天前完成首图',priority:'HIGH' as const,deadline:'2026-09-30T12:00:00.000Z'};
  assert.equal(rankUnifiedQueue([projected],[urgentAssignment],now)[0]?.id,`manual:${urgentAssignment.id}`);
});

test('System Copilot records the actual capability and reuses unchanged structured input',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'copilot-v13-')),{app,store}=await createApp(directory);t.after(()=>app.close());
  const previous={key:process.env.DASHSCOPE_API_KEY,workspace:process.env.COMMERCE_BAILIAN_WORKSPACE_ID,enabled:process.env.COMMERCE_COPY_ENABLED,market:process.env.COMMERCE_MARKET_AI_ENABLED};
  const oldFetch=globalThis.fetch;let calls=0;
  process.env.DASHSCOPE_API_KEY='test-only';process.env.COMMERCE_BAILIAN_WORKSPACE_ID='test-workspace';process.env.COMMERCE_COPY_ENABLED='1';process.env.COMMERCE_MARKET_AI_ENABLED='1';
  globalThis.fetch=async (_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);return new Response(JSON.stringify({id:'test-request',model:body.model,choices:[{message:{content:JSON.stringify({facts:[{text:'当前无人工指派',sourceRef:'tasks'}],inferences:[],recommendations:[],projectHealth:[]})},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:60}}),{status:200,headers:{'content-type':'application/json'}});};
  t.after(()=>{globalThis.fetch=oldFetch;for(const [key,value] of Object.entries({DASHSCOPE_API_KEY:previous.key,COMMERCE_BAILIAN_WORKSPACE_ID:previous.workspace,COMMERCE_COPY_ENABLED:previous.enabled,COMMERCE_MARKET_AI_ENABLED:previous.market})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const first=await app.inject({method:'POST',url:'/api/system-copilot/recommend',headers,payload:{}});
  assert.equal(first.statusCode,200,first.body);assert.equal(first.json().cached,false);
  const second=await app.inject({method:'POST',url:'/api/system-copilot/recommend',headers,payload:{}});
  assert.equal(second.statusCode,200,second.body);assert.equal(second.json().cached,true);
  assert.equal(calls,1);
  const row=store.db.prepare("SELECT capability,model,input_fingerprint,status FROM ai_inference_runs WHERE task_type='system_recommend'").get()!;
  assert.equal(row.capability,'SYSTEM_REASONING');assert.equal(row.status,'SUCCEEDED');assert.ok(first.json().inputBytes>0);
});
