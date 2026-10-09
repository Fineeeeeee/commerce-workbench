import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../apps/server/store.js';
import { createApp } from '../apps/server/app.js';
import { columns, csvText } from '../packages/contracts/market.js';
import { createMarketResearchOpportunities } from '../apps/server/market-opportunity.js';
import type { OpportunityPreview } from '../packages/contracts/market-opportunity.js';

test('V7 migration keeps platform and profile extensible and preserves task tables',()=>{
  const directory=mkdtempSync(join(tmpdir(),'market-v7-'));
  const store=new Store(directory);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
  const sql=String(store.db.prepare("SELECT sql FROM sqlite_master WHERE name='market_research_jobs'").get()!.sql);
  assert.doesNotMatch(sql,/source_platform\s+IN/i);
  assert.doesNotMatch(sql,/collection_profile\s+IN/i);
  assert.match(sql,/REVIEW_REQUIRED/);
  assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE name='jobs'").get());
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.ok(readdirSync(directory).some(name=>name.startsWith('before-market-research-v7-')));
  store.close();
});

test('analysis retry reuses candidates owned by the same research job',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'market-v7-idempotent-'));
  const {app,store}=await createApp(directory);t.after(()=>app.close());const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const row=columns.map(column=>({商品标题:'控油蓬松洗发水',商品链接:'https://example.com/jd',品牌:'测试牌',规格:'500ml',店铺:'测试店',榜单数值:'1',时间证据:'2026-09-21',类目:'洗发水',价格:'39.9',卖点原文:'控油 蓬松'} as Record<string,string>)[column]??'');
  await app.inject({method:'POST',url:'/api/market/batches',headers,payload:{batch:{name:'历史JD样本',source:'JD Union Jingfen selected pools',platform:'京东',periodStart:'2026-09-20',periodEnd:'2026-09-20',metricName:'京东联盟30天SKU引单量',metricUnit:'引单'},csv:csvText([[...columns],row])}});
  const response=await app.inject({method:'POST',url:'/api/market/batches',headers,payload:{batch:{name:'V7幂等样本',source:'JD Union Jingfen selected pools',platform:'京东',periodStart:'2026-09-21',periodEnd:'2026-09-21',metricName:'京东联盟30天SKU引单量',metricUnit:'引单'},csv:csvText([[...columns],row])}});const batchId=response.json().id as string;
  let calls=0;const runner=async(preview:OpportunityPreview)=>{calls++;const evidenceId=preview.included[0]!.id;return {output:{facts:[],inferences:[],opportunities:[{name:'候选',summary:'当前样本候选',price_band:'30–50元',specifications:['500ml'],core_basis:[{text:'控油',evidence_record_ids:[evidenceId]}],selling_points:[{term:'控油',category:'功效',evidence_record_ids:[evidenceId]}],risks:[],missing_data:['更多样本'],replicability:'MEDIUM' as const,replicability_reason:'需验证',evidence_record_ids:[evidenceId]}],risks:[],missing_data:['更多样本']},textSignals:{selling_point_groups:[]},metadata:{modelId:'test',modelVersion:'test',requestId:'request',promptVersion:'market-opportunity-v3' as const,fallbackUsed:false,lightModelId:'test-light',lightModelVersion:'test',lightRequestId:'light-request'}};};
  const jobId='11111111-1111-4111-8111-111111111111';const first=await createMarketResearchOpportunities(store,batchId,null,jobId,runner);const second=await createMarketResearchOpportunities(store,batchId,null,jobId,runner);
  assert.equal(calls,1);assert.deepEqual(second,first);assert.equal(store.db.prepare("SELECT count(*) count FROM product_opportunities WHERE json_extract(analysis_data,'$.marketResearchJobId')=?").get(jobId)!.count,1);
});

test('market research API enforces V7 whitelist and persists jobs for refresh recovery',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'market-v7-api-'));
  const {app}=await createApp(directory);t.after(()=>app.close());
  const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
  const created=await app.inject({method:'POST',url:'/api/market-research-jobs',headers,payload:{sourcePlatform:'jd',collectionProfile:'shampoo',targetCount:50,maxPages:10}});
  assert.equal(created.statusCode,201,created.body);assert.equal(created.json().state,'CREATED');
  const invalid=await app.inject({method:'POST',url:'/api/market-research-jobs',headers,payload:{sourcePlatform:'taobao',collectionProfile:'shampoo',targetCount:50,maxPages:10}});
  assert.equal(invalid.statusCode,400);
  const refreshed=await app.inject({method:'GET',url:'/api/market-research-jobs',headers});
  assert.equal(refreshed.statusCode,200);assert.equal(refreshed.json().length,1);assert.equal(refreshed.json()[0].id,created.json().id);
});
