import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { marketAnalysisModelOptions, marketFallbackModels, modelProfile } from '../apps/server/model-router.js';
import { requestStructured } from '../apps/server/structured-model-provider.js';
import { marketTextSignalsSchema, type MarketAiAnalysis, type MarketTextSignals } from '../packages/contracts/market-ai.js';
import { columns, csvText, type Batch, type Entry } from '../packages/contracts/market.js';
import { analyzeOpportunity, type OpportunityPreview, type ProductOpportunity } from '../packages/contracts/market-opportunity.js';
import { createMarketAiRunner } from '../apps/server/market-ai-service.js';

test('structured requests switch format only for a provider-identified format error', async t => {
  configured(t);
  const profile=modelProfile('market_text_signals','qwen3.8-max')!;
  const modes:string[]=[];
  const fetcher:typeof fetch=async (_url,init)=>{
    const body=JSON.parse(String(init?.body));modes.push(body.response_format?.type??'text_json');
    if(modes.length===1)return new Response(JSON.stringify({code:'invalid_parameter_error',error:{param:'response_format'}}),{status:400});
    return new Response(JSON.stringify({id:'fallback-request',model:profile.model,choices:[{message:{content:JSON.stringify({selling_point_groups:[]})},finish_reason:'stop'}]}));
  };
  const result=await requestStructured(profile,[{role:'user',content:'classify'}],'signals',{type:'object'},marketTextSignalsSchema,fetcher);
  assert.deepEqual(modes,['json_schema','json_object']);
  assert.equal(result.requestMode,'json_object');
  assert.deepEqual(result.attempts?.map(item=>item.status),['FAILED','SUCCEEDED']);
});

test('Qwen3.6 Plus starts in JSON Object mode and still validates locally', async t => {
  configured(t);
  const previous=process.env.COMMERCE_TEXT_FAST_MODEL;
  process.env.COMMERCE_TEXT_FAST_MODEL='qwen3.6-plus-2026-04-02';
  t.after(()=>previous===undefined?delete process.env.COMMERCE_TEXT_FAST_MODEL:process.env.COMMERCE_TEXT_FAST_MODEL=previous);
  const profile=modelProfile('market_text_signals')!;
  const fetcher:typeof fetch=async (_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.response_format.type,'json_object');
    assert.match(JSON.stringify(body.messages),/JSON/);
    return new Response(JSON.stringify({id:'json-object-request',model:profile.model,choices:[{message:{content:JSON.stringify({selling_point_groups:[]})},finish_reason:'stop'}]}));
  };
  assert.equal((await requestStructured(profile,[{role:'user',content:'classify'}],'signals',{type:'object'},marketTextSignalsSchema,fetcher)).requestMode,'json_object');
});

test('unidentified invalid parameter stops without repeating a charged request', async t => {
  configured(t);
  const profile=modelProfile('market_text_signals','qwen3.8-max')!;
  let calls=0;
  const fetcher:typeof fetch=async ()=>{calls++;return new Response(JSON.stringify({code:'invalid_parameter_error',request_id:'request-invalid'}),{status:400});};
  await assert.rejects(requestStructured(profile,[{role:'user',content:'classify'}],'signals',{type:'object'},marketTextSignalsSchema,fetcher),error=>{
    assert.equal((error as {code:string}).code,'REQUEST_INCOMPATIBLE');
    return true;
  });
  assert.equal(calls,1);
});

test('configured market fallback retains opportunity task configuration', t => {
  configured(t);
  const previous = process.env.COMMERCE_COPY_MODEL;
  process.env.COMMERCE_COPY_MODEL = 'qwen3.6-plus-2026-04-02';
  t.after(() => previous === undefined ? delete process.env.COMMERCE_COPY_MODEL : process.env.COMMERCE_COPY_MODEL = previous);
  const fallback = modelProfile('market_opportunity_analysis', 'qwen3.8-max');
  assert.equal(fallback?.task, 'market_opportunity_analysis');
  assert.equal(fallback?.model, 'qwen3.8-max');
});

test('model fallback stays within the task capability before using a stronger configured text model', t => {
  configured(t);
  assert.deepEqual(marketFallbackModels('market_opportunity_analysis','qwen3.8-max'),['qwen-plus']);
  assert.equal(marketFallbackModels('market_text_signals','qwen3.7-flash')[0],'qwen3.8-max');
  assert.equal(modelProfile('content_quality')?.capability,'TEXT_REASONING');
  assert.equal(modelProfile('product_brief')?.capability,'TEXT_REASONING');
  assert.equal(modelProfile('seo_listing')?.capability,'TEXT_REASONING');
});

test('one reasoning capability switch updates market, Brief, SEO and content tasks without business changes', t => {
  configured(t);
  const previous=process.env.COMMERCE_TEXT_REASONING_MODEL;
  process.env.COMMERCE_TEXT_REASONING_MODEL='qwen3.6-plus-2026-04-02';
  t.after(()=>previous===undefined?delete process.env.COMMERCE_TEXT_REASONING_MODEL:process.env.COMMERCE_TEXT_REASONING_MODEL=previous);
  for(const task of ['market_opportunity_analysis','product_brief','seo_listing','content_quality'] as const)assert.equal(modelProfile(task)?.model,'qwen3.6-plus-2026-04-02');
});

const headers = { host: '127.0.0.1:4380', origin: 'http://127.0.0.1:4380' };
const request = (app: Awaited<ReturnType<typeof createApp>>['app'], method: 'GET'|'POST', url: string, payload?: unknown) => app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
function configured(t: TestContext) {
  const values = { COMMERCE_TEXT_FAST_MODEL: 'qwen3.7-flash', COMMERCE_TEXT_REASONING_MODEL: 'qwen3.8-max', COMMERCE_COPY_ENABLED: '1', COMMERCE_BAILIAN_WORKSPACE_ID: 'test-workspace', DASHSCOPE_API_KEY: 'test-key' };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(values)) before[key] === undefined ? delete process.env[key] : process.env[key] = before[key]; });
}

test('市场模型路由按任务选择模型并发送 strict JSON Schema', async t => {
  configured(t); const profile = modelProfile('market_text_signals')!; assert.equal(profile.model, 'qwen3.7-flash'); assert.equal(profile.enableThinking, false);
  const output: MarketTextSignals = { selling_point_groups: [] };
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.response_format.json_schema.strict, true); assert.equal(body.enable_thinking, false);
    assert.equal(body.temperature, 0.1); assert.equal(body.max_tokens, 10000);
    return new Response(JSON.stringify({ id: 'request-1', model: 'qwen3.7-flash-2026-01-01', choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 } }));
  };
  const result = await requestStructured(profile, [{ role:'user',content:'test' }], 'signals', { type:'object' }, marketTextSignalsSchema, fetcher);
  assert.equal(result.requestId, 'request-1'); assert.deepEqual(result.output, output);
});

test('市场文本整理允许人工选用已配置的文案模型，不接受任意模型 ID', async t => {
  configured(t);
  const previous = process.env.COMMERCE_COPY_MODEL;
  process.env.COMMERCE_COPY_MODEL = 'qwen3.6-plus-2026-04-02';
  t.after(() => previous === undefined ? delete process.env.COMMERCE_COPY_MODEL : process.env.COMMERCE_COPY_MODEL = previous);
  assert.ok(!marketAnalysisModelOptions().includes('qwen3.6-plus-2026-04-02'));
  assert.ok(marketAnalysisModelOptions().includes('qwen3.8-max'));
  const selected = modelProfile('market_text_signals', 'qwen3.8-max')!;
  assert.equal(selected.model, 'qwen3.8-max');
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, selected.model);
    return new Response(JSON.stringify({ id: 'selected-model-request', model: selected.model, choices: [{ message: { content: JSON.stringify({ selling_point_groups: [] }) }, finish_reason: 'stop' }] }));
  };
  assert.equal((await requestStructured(selected, [{ role: 'user', content: 'test' }], 'signals', { type: 'object' }, marketTextSignalsSchema, fetcher)).requestId, 'selected-model-request');
  assert.throws(() => modelProfile('market_text_signals', 'unconfigured-model'), /未在文本能力配置中启用/);
});

test('市场机会原生 JSON Schema 同步非空规格与缺失字段约束', async () => {
  const { marketAiAnalysisJsonSchema } = await import('../packages/contracts/market-ai.js');
  const opportunity = marketAiAnalysisJsonSchema.properties.opportunities.items.properties;
  assert.equal(opportunity.specifications.items.minLength,1);
  assert.equal(opportunity.missing_data.items.minLength,2);
});

test('模型只接收短证据 ID，保存前映射回真实 UUID', async t => {
  configured(t); const ids: string[] = [randomUUID(),randomUUID(),randomUUID()];
  const entries = ids.map((id,index)=>({ id,batchId:'batch',rowNumber:index+2,raw:[],data:{title:`商品${index+1}`,url:'',brand:'品牌',specification:'500ml',shop:'店铺',barcode:'',value:1,timeEvidence:'2026-09-18',category:'洗发水',price:39.9,sellingPoints:'控油 蓬松',ingredients:'',packaging:'',marketingMode:'',externalDependence:''},reviews:[],analysis:{signal:'firstSeen' as const,matches:[],completeness:80,missing:[]} }));
  const preview = analyzeOpportunity({id:'batch',name:'样本',source:'测试',platform:'淘宝',periodStart:'2026-09-18',periodEnd:'2026-09-18',metricName:'记录',metricUnit:'条'},entries);
  let calls=0;
  const requester = (async (_profile: unknown,messages: Array<{content:string}>)=>{ calls++; const sent=JSON.stringify(messages); for(const id of ids) assert.ok(!sent.includes(id)); assert.ok(sent.includes('P01'));
    if(calls===1) return {requestId:'flash-request',modelVersion:'flash-version',usage:null,output:{selling_point_groups:[{term:'控油',category:'功效',evidence_record_ids:['P01','P02','P03']}]}};
    return {requestId:'plus-request',modelVersion:'plus-version',usage:null,output:{inferences:[{text:'当前样本显示控油诉求可继续验证',evidence_record_ids:['P01','P02','P03']}],opportunities:[{name:'控油机会',summary:'当前样本候选',price_band:'30–50元',specifications:['500ml'],core_basis:[{text:'控油表达',evidence_record_ids:['P01','P02','P03']}],selling_points:[{term:'控油',category:'功效',evidence_record_ids:['P01','P02','P03']}],risks:[{text:'样本有限',evidence_record_ids:['P01','P02','P03']}],missing_data:[],replicability:'MEDIUM',replicability_reason:'需进一步验证',evidence_record_ids:['P01','P02','P03']}],risks:[{text:'样本有限',evidence_record_ids:['P01','P02','P03']}],missing_data:[]}};
  }) as typeof requestStructured;
  const result=await createMarketAiRunner(requester)(preview);
  assert.equal(calls,2); assert.deepEqual(result.output.opportunities[0]!.evidence_record_ids,ids); assert.deepEqual(result.textSignals.selling_point_groups[0]!.evidence_record_ids,ids);
  assert.ok(result.output.facts.some(item=>item.text.includes('3 条有效样本'))); assert.ok(result.output.facts.every(item=>item.evidence_record_ids.every(id=>ids.includes(id))));
});

test('无意义缺失字段和越界市场判断会阻止候选保存', async t => {
  configured(t); const ids=[randomUUID(),randomUUID(),randomUUID()];
  const entries=ids.map((id,index)=>({id,batchId:'batch',rowNumber:index+2,raw:[],data:{title:`商品${index+1}`,url:'',brand:'品牌',specification:'500ml',shop:'店铺',barcode:'',value:1,timeEvidence:'2026-09-18',category:'洗发水',price:39.9,sellingPoints:'控油',ingredients:'',packaging:'',marketingMode:'',externalDependence:''},reviews:[],analysis:{signal:'firstSeen' as const,matches:[],completeness:80,missing:[]}}));
  const preview=analyzeOpportunity({id:'batch',name:'样本',source:'测试',platform:'淘宝',periodStart:'2026-09-18',periodEnd:'2026-09-18',metricName:'记录',metricUnit:'条'},entries);
  const requester=(async (_profile:unknown,_messages:unknown,_name:string)=> _name==='market_text_signals'
    ? {requestId:'flash',modelVersion:'flash',usage:null,output:{selling_point_groups:[]}}
    : {requestId:'plus',modelVersion:'plus',usage:null,output:{inferences:[{text:'当前样本显示可继续验证',evidence_record_ids:['P01','P02','P03']}],opportunities:[{name:'控油机会',summary:'当前样本候选',price_band:'',specifications:[],core_basis:[{text:'控油表达',evidence_record_ids:['P01','P02','P03']}],selling_points:[{term:'控油',category:'功效',evidence_record_ids:['P01','P02','P03']}],risks:[],missing_data:[':{'],replicability:'UNKNOWN',replicability_reason:'需验证',evidence_record_ids:['P01','P02','P03']}],risks:[],missing_data:[]}}) as typeof requestStructured;
  const recorded: Array<{status:string;errorCode:string|null;requestId:string|null}>=[];
  await assert.rejects(createMarketAiRunner(requester)(preview,{onRun:run=>recorded.push(run)}),/无业务意义/);
  assert.equal(recorded.filter(run=>run.status==='FAILED'&&run.errorCode==='OUTPUT_SEMANTIC_INVALID').length,2);
  assert.ok(recorded.every(run=>run.requestId));
  const overclaim=(async (_profile:unknown,_messages:unknown,_name:string)=> _name==='market_text_signals'
    ? {requestId:'flash',modelVersion:'flash',usage:null,output:{selling_point_groups:[]}}
    : {requestId:'plus',modelVersion:'plus',usage:null,output:{inferences:[{text:'当前样本填补市场空白',evidence_record_ids:['P01','P02','P03']}],opportunities:[{name:'控油机会',summary:'当前样本候选',price_band:'',specifications:[],core_basis:[{text:'控油表达',evidence_record_ids:['P01','P02','P03']}],selling_points:[{term:'控油',category:'功效',evidence_record_ids:['P01','P02','P03']}],risks:[],missing_data:['达人信息'],replicability:'UNKNOWN',replicability_reason:'需验证',evidence_record_ids:['P01','P02','P03']}],risks:[],missing_data:['达人信息']}}) as typeof requestStructured;
  await assert.rejects(createMarketAiRunner(overclaim)(preview),/小样本无法支持/);
  const invalidSpecification=(async (_profile:unknown,_messages:unknown,_name:string)=> _name==='market_text_signals'
    ? {requestId:'flash',modelVersion:'flash',usage:null,output:{selling_point_groups:[]}}
    : {requestId:'plus',modelVersion:'plus',usage:null,output:{inferences:[{text:'当前样本显示可继续验证',evidence_record_ids:['P01','P02','P03']}],opportunities:[{name:'控油机会',summary:'当前样本候选',price_band:'',specifications:[':'],core_basis:[{text:'控油表达',evidence_record_ids:['P01','P02','P03']}],selling_points:[{term:'控油',category:'功效',evidence_record_ids:['P01','P02','P03']}],risks:[],missing_data:['规格'],replicability:'UNKNOWN',replicability_reason:'需验证',evidence_record_ids:['P01','P02','P03']}],risks:[],missing_data:['规格']}}) as typeof requestStructured;
  await assert.rejects(createMarketAiRunner(invalidSpecification)(preview),/规格字段/);
});

test('AI 市场分析只创建草稿候选，人工审核后才能成为正式机会', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'market-ai-'));
  const runner = async (preview: OpportunityPreview) => {
    const evidenceId = preview.included[0]!.id;
    const textSignals: MarketTextSignals = { selling_point_groups:[{term:'控油',category:'功效',evidence_record_ids:[evidenceId]}] };
    const output: MarketAiAnalysis = { facts:[{text:'当前样本包含控油卖点',evidence_record_ids:[evidenceId]}],inferences:[{text:'可继续验证控油需求',evidence_record_ids:[evidenceId]}],opportunities:[{name:'控油洗发水机会候选',summary:'仅代表当前样本的待审核候选。',price_band:'30–50元',specifications:['500ml'],core_basis:[{text:'控油卖点出现',evidence_record_ids:[evidenceId]}],selling_points:[{term:'控油',category:'功效',evidence_record_ids:[evidenceId]}],risks:[{text:'样本量有限',evidence_record_ids:[evidenceId]}],missing_data:['评价数'],replicability:'MEDIUM',replicability_reason:'仍需补充配方与评价证据',evidence_record_ids:[evidenceId]}],risks:[{text:'样本量有限',evidence_record_ids:[evidenceId]}],missing_data:['评价数'] };
    return { output,textSignals,metadata:{modelId:'qwen3.7-plus',modelVersion:'qwen3.7-plus-test',requestId:'request-plus',promptVersion:'market-opportunity-v3',fallbackUsed:false,lightModelId:'qwen3.7-flash',lightModelVersion:'qwen3.7-flash-test',lightRequestId:'request-flash'} };
  };
  const { app, store } = await createApp(directory, undefined, runner); t.after(() => app.close());
  const row = columns.map(column => ({ 商品标题:'控油蓬松洗发水',商品链接:'https://example.com/item',品牌:'测试牌',规格:'500ml',店铺:'测试店',榜单数值:'1',时间证据:'2026-09-18',类目:'洗发水',价格:'39.9',卖点原文:'控油 蓬松' } as Record<string,string>)[column] ?? '');
  const created = await request(app,'POST','/api/market/batches',{batch:{name:'样本',source:'测试',platform:'淘宝',periodStart:'2026-09-18',periodEnd:'2026-09-18',metricName:'记录',metricUnit:'条'},csv:csvText([[...columns],row])});
  const batch = created.json() as Batch; const entries = ((await request(app,'GET',`/api/market/batches/${batch.id}/entries`)).json().entries) as Entry[];
  const analyzed = await request(app,'POST','/api/market/ai-analysis',{batchId:batch.id,entryIds:[entries[0]!.id],categoryId:null});
  assert.equal(analyzed.statusCode,201,analyzed.body); const candidate = (analyzed.json() as ProductOpportunity[])[0]!;
  assert.equal(candidate.status,'DRAFT'); assert.equal(candidate.analysis.modelMetadata?.requestId,'request-plus'); assert.equal(candidate.keywords[0]!.sourceEntryIds[0],entries[0]!.id);
  assert.equal(store.db.prepare('SELECT status FROM product_opportunities WHERE id=?').get(candidate.id)!.status,'DRAFT');
  const stale={...candidate.analysis,modelMetadata:{...candidate.analysis.modelMetadata!,promptVersion:'market-opportunity-v1'}};
  store.db.prepare('UPDATE product_opportunities SET analysis_data=? WHERE id=?').run(JSON.stringify(stale),candidate.id);
  const blocked=await request(app,'POST',`/api/product-opportunities/${candidate.id}/review`,{decision:'APPROVED',reviewer:'测试审核人',note:'旧规则不应通过'});
  assert.equal(blocked.statusCode,409); assert.equal(blocked.json().error.code,'STALE_AI_CANDIDATE');
  store.db.prepare('UPDATE product_opportunities SET analysis_data=? WHERE id=?').run(JSON.stringify(candidate.analysis),candidate.id);
  const reviewed = await request(app,'POST',`/api/product-opportunities/${candidate.id}/review`,{decision:'APPROVED',reviewer:'测试审核人',note:'证据引用检查通过'});
  assert.equal(reviewed.statusCode,200,reviewed.body); assert.equal((reviewed.json() as ProductOpportunity).status,'READY');
  assert.equal((reviewed.json() as ProductOpportunity).analysis.review?.reviewer,'测试审核人');
});
import { mkdtempSync } from 'node:fs';
import { tmpdir as fixtureTmpdir } from 'node:os';
import { join as fixtureJoin } from 'node:path';
// Keep routing fixtures independent of local persisted model selections.
process.chdir(mkdtempSync(fixtureJoin(fixtureTmpdir(), 'market-model-fixtures-')));
