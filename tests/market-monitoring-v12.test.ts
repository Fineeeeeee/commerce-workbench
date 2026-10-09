import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { aggregateChanges, monitorSignalRules, signalChanges, snapshotFacts } from '../apps/server/market-monitoring-facts.js';
import { detectMonitoringChanges, validatedMonitoringComparison, filterFingerprint, monitoringResumeStage } from '../apps/server/market-monitoring.js';

test('monitoring resumes saved artifacts even when a failed retry corrupted the stage; missing filter only prohibits comparison',()=>{
  const report=join(mkdtempSync(join(tmpdir(),'monitor-filter-')),'report.md');
  writeFileSync(report,'# report\n筛选只使用实际返回的类目与标题；洗发水沿用已验证的类目及标题规则。\n## 产物\n');
  const fingerprint=filterFingerprint(report);assert.equal(typeof fingerprint,'string');
  writeFileSync(report,'# report\n## 产物\n');assert.equal(filterFingerprint(report),null);
  assert.equal(monitoringResumeStage({collection_data:JSON.stringify({failedStage:'FAILED',normalized_json_path:'saved.json'})}),'NORMALIZING');
  assert.equal(monitoringResumeStage({collection_data:JSON.stringify({adapted:{batch:{}}})}),'IMPORTING');
  assert.equal(monitoringResumeStage({market_batch_id:'saved-batch',collection_data:'{}'}),'DETECTING');
  assert.throws(()=>monitoringResumeStage({collection_data:JSON.stringify({failedStage:'FAILED'})}),/无法确认/);
});

test('monitor retry queues normalization instead of recollecting and repeated submission is rejected',async t=>{
  const {app,store}=await createApp(mkdtempSync(join(tmpdir(),'monitor-resume-')));t.after(()=>app.close());
  const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const created=await app.inject({method:'POST',url:'/api/market-monitoring/runs',headers,payload:{}});const id=created.json().id;
  store.db.prepare("UPDATE market_monitoring_runs SET state='FAILED',collection_data=? WHERE id=?").run(JSON.stringify({normalized_json_path:'saved.json',failedStage:'FAILED'}),id);
  const retried=await app.inject({method:'POST',url:`/api/market-monitoring/runs/${id}/retry`,headers,payload:{}});
  assert.equal(retried.statusCode,200);assert.equal(retried.json().state,'NORMALIZING');assert.equal(retried.json().retryCount,1);
  assert.equal((await app.inject({method:'POST',url:`/api/market-monitoring/runs/${id}/retry`,headers,payload:{}})).statusCode,409);
  assert.equal(store.db.prepare('select count(*) n from market_monitoring_runs').get()!.n,1);
});

test('V12 migration preserves old objects and creates no invented snapshots',async t=>{
  const {app,store}=await createApp(mkdtempSync(join(tmpdir(),'commerce-v12-')));t.after(()=>app.close());
  assert.equal(Number(store.db.prepare('pragma user_version').get()!.user_version), 16);
  assert.equal(store.db.prepare('select count(*) n from market_monitoring_runs').get()!.n,0);
  assert.equal(store.db.prepare('select count(*) n from market_signals').get()!.n,0);
  assert.equal(store.db.prepare('pragma foreign_key_check').all().length,0);
  const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const first=await app.inject({method:'POST',url:'/api/market-monitoring/runs',headers,payload:{}});
  const repeated=await app.inject({method:'POST',url:'/api/market-monitoring/runs',headers,payload:{}});
  assert.equal(first.statusCode,201);
  assert.equal(repeated.statusCode,200);
  assert.equal(repeated.json().id,first.json().id);
  assert.equal(store.db.prepare('select count(*) n from market_monitoring_runs').get()!.n,1);
});

test('only comparable complete scopes produce aggregate changes; unstable itemId never becomes product entry or exit',async t=>{
  const {app,store}=await createApp(mkdtempSync(join(tmpdir(),'commerce-v12-compare-')));t.after(()=>app.close());
  const time=new Date().toISOString(),batchIds=[randomUUID(),randomUUID()],runIds=[randomUUID(),randomUUID()];
  const scope=JSON.stringify({eliteIds:[22,25,27,28],maxPages:10,pageSize:50,categoryIds:[16750,16751,16756,16761]});
  for(const [index,batchId] of batchIds.entries()){
    store.db.prepare('INSERT INTO market_batches VALUES (?,?,?,?,?,?,?,?,?)').run(batchId,`快照${index}`,'JD Union Jingfen selected pools','京东','2026-09-20','2026-09-21','京东联盟30天SKU引单量','引单',time);
    for(let n=0;n<4;n++)store.db.prepare('INSERT INTO market_entries (id,batch_id,row_number,raw_data,normalized_data,created_at,source_product_id,source_metadata) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),batchId,n+1,'[]',JSON.stringify({title:`控油洗发水 ${n}`,brand:index?'乙品牌':'甲品牌',shop:'测试店',price:index?59:69,sellingPoints:'控油',specification:'500ml'}),time,`volatile-${index}-${n}`,JSON.stringify({source_scope:'jd_union_jingfen',source_price:index?59:69}));
    store.db.prepare('INSERT INTO market_monitoring_runs (id,source_platform,collection_profile,source_scope,pool_scope,page_size,max_pages,trigger_type,state,market_batch_id,captured_at,collection_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runIds[index]!,'jd','shampoo','jd_union_jingfen_multi_pool',scope,50,10,'HISTORICAL','COMPLETED',batchId,`2026-09-2${index}T00:00:00Z`,JSON.stringify({complete:true,filterFingerprint:'same-filter',pools:[22,25,27,28].map(eliteId=>({eliteId,pages:10}))}),time,time);
  }
  const before=snapshotFacts(store,batchIds[0]!),after=snapshotFacts(store,batchIds[1]!);
  assert.equal(before.medianPrice,69);assert.equal(after.medianPrice,59);
  const changes=aggregateChanges(before,after);
  assert.ok(changes.some(change=>change.type==='MEDIAN_PRICE_CHANGED'));
  assert.ok(!changes.some(change=>change.type==='PRODUCT_ENTERED'||change.type==='PRODUCT_EXITED'));
  assert.ok(signalChanges(changes,4).some(change=>change.type==='MEDIAN_PRICE_CHANGED'));
  assert.equal(monitorSignalRules({COMMERCE_MONITOR_MEDIAN_PRICE_DELTA:'20'}).medianPriceDelta,20);
  assert.ok(!signalChanges(changes,4,monitorSignalRules({COMMERCE_MONITOR_MEDIAN_PRICE_DELTA:'20'})).some(change=>change.type==='MEDIAN_PRICE_CHANGED'));
  const result=detectMonitoringChanges(store,runIds[1]!);
  assert.equal(result.comparable,true);
  const signalCount=Number(store.db.prepare('select count(*) n from market_signals').get()!.n);
  assert.ok(signalCount>=1);
  detectMonitoringChanges(store,runIds[1]!);
  assert.equal(store.db.prepare('select count(*) n from market_signals').get()!.n,signalCount);
  store.db.prepare('UPDATE market_monitoring_runs SET comparison_data=? WHERE id=?').run(JSON.stringify(result),runIds[1]!);
  const dashboard=await app.inject({method:'GET',url:'/api/market-monitoring/dashboard',headers:{host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'}});
  assert.equal(dashboard.statusCode,200);
  assert.equal(dashboard.json().facts.sampleSize,4);
  const sliced=await app.inject({method:'GET',url:'/api/market-monitoring/dashboard?brand=%E4%B9%99%E5%93%81%E7%89%8C&priceMax=60',headers:{host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'}});
  assert.equal(sliced.statusCode,200);
  assert.equal(sliced.json().facts.sampleSize,4);
  assert.equal(sliced.json().sliceFacts.sampleSize,4);
  assert.equal(sliced.json().sliceFacts.medianPrice,59);
  const emptySlice=await app.inject({method:'GET',url:'/api/market-monitoring/dashboard?priceMin=100',headers:{host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'}});
  assert.equal(emptySlice.json().sliceFacts.sampleSize,0);
  assert.ok(dashboard.json().signals.every((signal:{type:string})=>!['PRODUCT_ENTERED','PRODUCT_EXITED'].includes(signal.type)));
  assert.equal(store.db.prepare('pragma foreign_key_check').all().length,0);
  store.db.prepare('UPDATE market_monitoring_runs SET collection_data=? WHERE id=?').run(JSON.stringify({complete:true,filterFingerprint:'same-filter',pools:[{eliteId:22,pages:9},{eliteId:25,pages:10},{eliteId:27,pages:10},{eliteId:28,pages:10}]}),runIds[0]!);
  assert.equal(detectMonitoringChanges(store,runIds[1]!).comparable,false);
  const storedRun=store.db.prepare('SELECT * FROM market_monitoring_runs WHERE id=?').get(runIds[1]!)!;
  const invalidated=validatedMonitoringComparison(store,storedRun);
  assert.equal(invalidated.comparable,false);
  assert.deepEqual(invalidated.changes,[]);
  assert.deepEqual(invalidated.signals,[]);
  const invalidDashboard=await app.inject({method:'GET',url:'/api/market-monitoring/dashboard',headers:{host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'}});
  assert.equal(invalidDashboard.json().comparison.comparable,false);
  assert.deepEqual(invalidDashboard.json().signals,[]);
  const obsoleteSignal=store.db.prepare('SELECT id FROM market_signals WHERE monitoring_run_id=? LIMIT 1').get(runIds[1]!)!;
  const invalidExplanation=await app.inject({method:'POST',url:`/api/market-monitoring/signals/${obsoleteSignal.id}/explain`,headers:{host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'},payload:{}});
  assert.equal(invalidExplanation.statusCode,409);
  assert.equal(invalidExplanation.json().error.code,'COMPARISON_NOT_RELIABLE');
  const invalidOverview=await app.inject({method:'GET',url:'/api/overview-work',headers:{host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'}});
  assert.ok(!invalidOverview.json().attention.some((item:{kind:string})=>item.kind==='monitoring'));
  assert.equal(JSON.parse(String(storedRun.comparison_data)).comparable,true,'read projection must not rewrite historical facts');
  store.db.prepare('UPDATE market_monitoring_runs SET collection_data=? WHERE id=?').run(JSON.stringify({complete:false,filterFingerprint:'same-filter'}),runIds[0]!);
  const blocked=detectMonitoringChanges(store,runIds[1]!);
  assert.equal(blocked.comparable,false);
  assert.equal(blocked.changes.length,0);
  for(const id of runIds)store.db.prepare('UPDATE market_monitoring_runs SET collection_data=? WHERE id=?').run(JSON.stringify({complete:true,pools:[22,25,27,28].map(eliteId=>({eliteId,pages:10}))}),id!);
  assert.equal(detectMonitoringChanges(store,runIds[1]!).comparable,false,'matching missing fingerprints do not prove matching filter scope');
  assert.equal(validatedMonitoringComparison(store,store.db.prepare('SELECT * FROM market_monitoring_runs WHERE id=?').get(runIds[1]!)!).comparable,false);
});
