import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migrateVisualGuidesV14 } from '../apps/server/visual-guide-migration.js';
import { createApp } from '../apps/server/app.js';
import { assembleReferencePrompt,guideTextViolations,type VisualGuide } from '../packages/contracts/visual-guide.js';
import { createPages } from '../packages/contracts/domain.js';
import { renderSvg } from '../packages/contracts/render.js';
import { productFacts } from '../packages/contracts/content-template.js';
import { imageProfile,requestImage } from '../apps/server/image-provider.js';
import { referencePageIssues } from '../apps/server/visual-guide.js';
import type { Store } from '../apps/server/store.js';

const data={name:'测试指南',style:'自然光',channels:['taobao'],identityConstraints:['保持瓶身与标签'],imageTypes:[{pageIds:['F01'],composition:'商品居中'}],prohibitions:[{code:'BAD_CLAIM',description:'禁止虚构功效',severity:'BLOCK' as const,checkMethod:'TEXT' as const,terms:['生发']}]};
test('V14 migration backs up V13 and preserves existing rows without fabricated guides',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'guide-migration-')),db=new DatabaseSync(join(dir,'workbench.sqlite'));t.after(()=>db.close());
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE categories(id TEXT PRIMARY KEY);INSERT INTO categories VALUES('kept');CREATE TABLE preserved(id TEXT);INSERT INTO preserved VALUES('unchanged');PRAGMA user_version=13;");
  migrateVisualGuidesV14(db,dir);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,14);
  assert.equal(db.prepare('SELECT id FROM preserved').get()!.id,'unchanged');
  assert.equal(db.prepare('SELECT count(*) n FROM category_visual_guides').get()!.n,0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  const backup=new DatabaseSync(join(dir,(await readdir(dir)).find(file=>file.startsWith('before-visual-guide'))!));t.after(()=>backup.close());assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version,13);
});
test('guide confirmation supersedes only that category and retains immutable history',async t=>{
  const {app,store}=await createApp(await mkdtemp(join(tmpdir(),'guide-api-')));t.after(()=>app.close());
  const categoryId=String(store.db.prepare("SELECT id FROM categories WHERE code='shampoo'").get()!.id),headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const draft=async()=>{const response=await app.inject({method:'POST',url:'/api/visual-guides',headers,payload:{categoryId,data,sources:[]}});assert.equal(response.statusCode,201);return response.json();};
  const first=await draft();assert.equal(first.status,'DRAFT');
  const confirm=async(id:string)=>app.inject({method:'POST',url:`/api/visual-guides/${id}/confirm`,headers,payload:{confirm:true}});
  assert.equal((await confirm(first.id)).statusCode,200);assert.equal((await confirm(first.id)).statusCode,200);
  const second=await draft();assert.equal(second.version,2);await confirm(second.id);
  assert.equal(store.db.prepare('SELECT status FROM category_visual_guides WHERE id=?').get(first.id)!.status,'SUPERSEDED');
  assert.equal((await confirm(first.id)).statusCode,409);assert.equal(store.db.prepare('SELECT count(*) n FROM category_visual_guides').get()!.n,2);
});
test('three-layer prompt excludes unconfirmed facts and full-image render never duplicates product or copy',()=>{
  const product={name:'测试洗发水',brand:'测试',variant:'',specification:'500ml',audience:'',origin:'',notes:'内部信息不发送',claims:[{id:randomUUID(),label:'未核实',text:'生发',source:'未确认',status:'pending' as const}]};
  const page={...createPages(product)[0]!,headline:'真实标题',copyStatus:'confirmed' as const};
  const guide:VisualGuide={id:randomUUID(),categoryId:randomUUID(),version:1,status:'CONFIRMED',data,sources:[],createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString()};
  const input=assembleReferencePrompt(guide,page,productFacts(product,page),randomUUID(),'hash');
  assert.match(input.prompt,/商品事实优先/);assert.match(input.prompt,/类目规则/);assert.match(input.prompt,/页面文案/);assert.ok(!input.facts.some(fact=>fact.value==='生发'));assert.ok(!input.prompt.includes(product.notes));
  const svg=renderSvg({...page,visualMode:'REFERENCE_IMAGE'},product,'original-product','final-candidate');assert.equal((svg.match(/<image /g)??[]).length,1);assert.ok(!svg.includes('original-product'));assert.ok(!svg.includes('真实标题'));
  assert.equal(guideTextViolations(data,{...page,body:'生发'}).length,1);
});
test('reference image adapter sends image plus text and supported edit parameters without thinking or 2K shortcuts',async t=>{
  const keys=['COMMERCE_IMAGE_ENABLED','DASHSCOPE_API_KEY','COMMERCE_BAILIAN_WORKSPACE_ID'];const previous=keys.map(key=>process.env[key]);Object.assign(process.env,{COMMERCE_IMAGE_ENABLED:'1',DASHSCOPE_API_KEY:'fixture-only',COMMERCE_BAILIAN_WORKSPACE_ID:'fixture'});t.after(()=>keys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i]));
  const profile={...imageProfile('quality','qwen-image-edit-plus')!,engine:'REFERENCE_IMAGE' as const,seed:39071};
  await requestImage(profile,'prompt','data:image/png;base64,YQ==','1024*1024',async(_,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.input.messages[0].content[0].image,'data:image/png;base64,YQ==');assert.equal(body.parameters.enable_thinking,undefined);assert.equal(body.parameters.size,'1024*1024');
    assert.equal(body.parameters.seed,39071);assert.equal(body.parameters.edit_mode,undefined);
    return new Response(JSON.stringify({request_id:'fixture',output:{choices:[{finish_reason:'stop',message:{content:[{image:'https://fixture.aliyuncs.com/image.png'}]}}]}}));
  });
});

test('reference candidate cannot retain delivery approval when confirmed copy changes',()=>{
  const product={name:'测试洗发水',brand:'测试',variant:'',specification:'500ml',audience:'',origin:'',notes:'',claims:[]};
  const page={...createPages(product)[0]!,headline:'已确认标题',copyStatus:'confirmed' as const,visualMode:'REFERENCE_IMAGE' as const,visualArtifactId:randomUUID()};
  const guide:VisualGuide={id:randomUUID(),categoryId:randomUUID(),version:1,status:'CONFIRMED',data,sources:[],createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString()};
  const input=assembleReferencePrompt(guide,page,productFacts(product,page),page.assetId??randomUUID(),'hash');
  const store={db:{prepare:()=>({get:()=>({validated_data:JSON.stringify({referenceInput:input})})})}} as unknown as Store;
  assert.ok(referencePageIssues(store,{...page,headline:'修改后的标题'}).some(issue=>issue.includes('重新生成')));
});
