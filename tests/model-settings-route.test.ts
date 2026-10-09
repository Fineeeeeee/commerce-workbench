import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readModelSettings, saveModelSetting } from '../apps/server/model-settings.js';
import { preserveWorkspaceUiHash } from '../apps/web/src/workspace-route.js';
import { statusTone } from '../apps/web/src/status-vocabulary.js';
import { createApp } from '../apps/server/app.js';
import { randomUUID } from 'node:crypto';

test('设置接口只保存模型选择，不创建 AI run 或修改业务记录',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'commerce-model-api-'));
  const {app,store}=await createApp(directory);t.after(()=>app.close());
  const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const before=store.db.prepare('SELECT count(*) n FROM ai_inference_runs').get()!.n;
  const result=await app.inject({method:'PUT',url:'/api/model-settings/PRODUCT_BRIEF',headers,payload:{model:'qwen3.8-max'}});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().overrides.PRODUCT_BRIEF,'qwen3.8-max');
  assert.equal((await app.inject({method:'GET',url:'/api/model-settings',headers})).json().overrides.PRODUCT_BRIEF,'qwen3.8-max');
  assert.equal((await app.inject({method:'PUT',url:'/api/model-settings/UNKNOWN',headers,payload:{model:'qwen3.8-max'}})).statusCode,400);
  assert.equal((await app.inject({method:'PUT',url:'/api/model-settings/TEXT_REASONING',headers,payload:{model:'qwen3.8-max',secret:'not-accepted'}})).statusCode,400);
  assert.equal(store.db.prepare('SELECT count(*) n FROM ai_inference_runs').get()!.n,before);
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 16);
});

test('模型切换不会改变已排队文案任务的配置快照',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'commerce-model-active-')),{app,store}=await createApp(directory);t.after(()=>app.close());
  const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const product=store.createProduct({name:'测试商品',brand:'测试',variant:'',specification:'500ml',audience:'',origin:'',notes:'',claims:[]});
  const kit=(await app.inject({method:'POST',url:`/api/products/${product.id}/kits`,headers,payload:{name:'模型保护测试',detailCount:12}})).json();
  const jobId=randomUUID(),taskId=randomUUID(),time=new Date().toISOString();
  store.db.prepare('INSERT INTO jobs (id,kit_id,kit_version,product_id,product_version,operation,input_snapshot,profile_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(jobId,kit.id,kit.version,product.id,product.version,'copy','{}','{"model":"original"}',time);
  store.db.prepare("INSERT INTO tasks (id,job_id,page_id,ordinal,state,stage,total,created_at,updated_at) VALUES (?,?,?,0,'queued','等待执行',1,?,?)").run(taskId,jobId,kit.pages[0].id,time,time);
  const save=()=>app.inject({method:'PUT',url:'/api/model-settings/COPY_GENERATION',headers,payload:{model:'qwen3.6-plus-2026-04-02'}});
  const blocked=await save();assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error.code,'MODEL_TASK_ACTIVE');
  assert.deepEqual(readModelSettings(directory),{});
  assert.equal(store.db.prepare('SELECT profile_snapshot FROM jobs WHERE id=?').get(jobId)!.profile_snapshot,'{"model":"original"}');
  store.db.prepare("UPDATE tasks SET state='cancelled' WHERE id=?").run(taskId);
  assert.equal((await save()).statusCode,200);
});

test('功能模型独立保存，清空一项恢复默认，不修改其他功能',()=>{
  const directory=mkdtempSync(join(tmpdir(),'commerce-model-settings-'));
  assert.deepEqual(readModelSettings(directory),{});
  saveModelSetting('COPY_GENERATION',' qwen3.6-plus-2026-04-02 ',directory);
  saveModelSetting('PRODUCT_BRIEF','qwen3.8-max',directory);
  assert.equal(readModelSettings(directory).COPY_GENERATION,'qwen3.6-plus-2026-04-02');
  saveModelSetting('COPY_GENERATION',null,directory);
  assert.deepEqual(readModelSettings(directory),{PRODUCT_BRIEF:'qwen3.8-max'});
  assert.deepEqual(JSON.parse(readFileSync(join(directory,'model-settings.json'),'utf8')),{PRODUCT_BRIEF:'qwen3.8-max'});
  assert.throws(()=>saveModelSetting('IMAGE_GENERATION','unsupported-image',directory));
  assert.throws(()=>saveModelSetting('TEXT_REASONING','https://secret.example',directory));
});

test('业务 URL 更新保留同页面的 Tab 和抽屉，不污染跨页面路径',()=>{
  const current='#/studio?sku=old&kit=k&page=p&ui.editorTab=visual&ui.imageCandidate=c';
  const next=preserveWorkspaceUiHash('#/studio?sku=new&kit=k&page=p&from=project&project=pr',current);
  const params=new URLSearchParams(next.split('?')[1]);
  assert.equal(params.get('sku'),'new');assert.equal(params.get('project'),'pr');
  assert.equal(params.get('ui.editorTab'),'visual');assert.equal(params.get('ui.imageCandidate'),'c');
  assert.equal(preserveWorkspaceUiHash('#/market?batch=b',current),'#/market?batch=b');
  assert.equal(preserveWorkspaceUiHash('#/studio?sku=s','#/studio?ui.editorTab=%3Cscript%3E'),'#/studio?sku=s');
});

test('展示颜色归一不合并业务状态：正常灰色、需处理和异常可辨',()=>{
  for(const state of ['READY','CONFIRMED','SUPERSEDED','reviewed'])assert.equal(statusTone(state),'neutral');
  assert.equal(statusTone('DRAFT'),'action');
  for(const state of ['Queued','Processing','RUNNING'])assert.equal(statusTone(state),'running');
  for(const state of ['Failed','Timeout'])assert.equal(statusTone(state),'error');
});
