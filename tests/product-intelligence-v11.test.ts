import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { keywordIntelligence } from '../apps/server/keyword-intelligence.js';
import { imageAt, inspectionInstruction, finalCompositeIssues } from '../apps/server/vision-inspection.js';
import { exportIssues } from '../apps/server/media.js';
import sharp from 'sharp';
import { listingQualityIssues } from '../packages/contracts/listing-quality.js';
import { listingCandidateSchema, listingContentSchema } from '../packages/contracts/product-intelligence.js';

const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
const productInput={name:'LEADR溪畔幽兰香氛洗发水',brand:'LEADR',variant:'',specification:'500ml',audience:'油性发质',origin:'广州',notes:'',claims:[]};
const marketRow=(title:string,price:number)=>({title,url:'',brand:'',specification:'500ml',shop:'',barcode:'',value:0,timeEvidence:'',category:'洗发水',price,sellingPoints:title,ingredients:'',packaging:'',marketingMode:'',externalDependence:''});
const listingCandidate=()=>({titles:[{text:`${productInput.name} 500ml`,sourceFactIds:['product.name','product.brand','product.specification'],keywordTerms:['香氛']}],suggestedKeywords:[],sellingPoints:[{text:'溪畔幽兰香氛洗发水',sourceFactIds:['product.name']}],detailSuggestions:[{text:'单瓶净含量500ml',sourceFactIds:['product.specification']}],risks:[]});

test('background inspection does not require a bottle; final pages require confirmed copy and template facts',async t=>{
  assert.match(inspectionInstruction('BACKGROUND_ASSET'),/不要因缺少瓶子/);
  assert.match(inspectionInstruction('FINAL_COMPOSITE'),/标签和包装/);
  const {app,store}=await createApp(mkdtempSync(join(tmpdir(),'commerce-final-check-')));t.after(()=>app.close());
  const sku=store.createProduct(productInput);
  const kitResponse=await app.inject({method:'POST',url:`/api/products/${sku.id}/kits`,headers,payload:{name:'质检套图',detailCount:12}});
  const kit=kitResponse.json();
  const result=finalCompositeIssues(store,kit.id,kit.pages[2].id);
  assert.ok(result.issues.includes('文案尚未人工确认'));
  assert.ok(result.issues.some(issue=>issue.includes('ingredient')));
  const reviewed = { ...result.kit, pages: result.kit.pages.map(page => ({ ...page, reviewed: true })) };
  assert.ok(exportIssues(store, reviewed).some(issue => issue.includes('文案尚未人工确认')));
  assert.ok(exportIssues(store, reviewed).some(issue => issue.includes('ingredient')));
});

test('V11 migration preserves V10 objects and keyword numbers come only from market records',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'commerce-v11-')),{app,store}=await createApp(directory);
  t.after(()=>app.close());
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
  assert.ok(readdirSync(directory).some(name=>name.startsWith('before-product-intelligence-v11-')));
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM product_briefs').get()!.n,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM listing_contents').get()!.n,0);
  const batchId=randomUUID(),time=new Date().toISOString();
  store.db.prepare('INSERT INTO market_batches VALUES (?,?,?,?,?,?,?,?,?)').run(batchId,'真实样本','人工采集','淘宝','2026-09-01','2026-09-02','榜单数值','条',time);
  for(const [index,row] of [marketRow('控油蓬松洗发水',49),marketRow('控油洗发露',69)].entries())store.db.prepare('INSERT INTO market_entries (id,batch_id,row_number,raw_data,normalized_data,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),batchId,index+1,'[]',JSON.stringify(row),time);
  const result=keywordIntelligence(store,batchId);
  assert.equal(result.sampleSize,2);
  assert.equal(result.medianPrice,59);
  assert.equal(result.priceSampleSize,2);
  assert.equal(result.keywords.find(item=>item.term==='控油')?.productCount,2);
  assert.equal(result.keywords.find(item=>item.term==='控油')?.titleCount,2);
  assert.deepEqual(result.keywords.find(item=>item.term==='控油')?.priceRange,{min:49,max:69});
  assert.match(result.scopeNote,/不代表平台搜索量或趋势/);
  const apiResult=await app.inject({method:'GET',url:`/api/market/batches/${batchId}/keyword-intelligence`,headers});
  assert.equal(apiResult.statusCode,200);
  assert.equal(apiResult.json().sampleSize,2);
});

test('Listing confirmation is append-only by SKU and channel; AI output alone is not formal content',async t=>{
  const {app,store}=await createApp(mkdtempSync(join(tmpdir(),'commerce-v11-listing-')));t.after(()=>app.close());
  const sku=store.createProduct(productInput),runId=randomUUID(),time=new Date().toISOString();
  store.db.prepare(`INSERT INTO ai_inference_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,'seo_listing','TEXT_REASONING','sku',sku.id,'bailian','test-model','test-model','hash','{}','{}','SUCCEEDED',2,null,null,null,time);
  const saveDraft=(version:number)=>{const id=randomUUID();store.db.prepare('INSERT INTO listing_contents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,sku.id,'taobao',version,'DRAFT',runId,`${sku.name} ${sku.specification}`,'[]',JSON.stringify(listingCandidate()),JSON.stringify(['product.name','product.specification']),time,null);return id;};
  const first=saveDraft(1);
  const post=(id:string,title:string)=>app.inject({method:'POST',url:`/api/listing-contents/${id}/confirm`,headers,payload:{title,titleFactIds:listingCandidate().titles[0]!.sourceFactIds,keywords:['香氛'],suggestions:listingCandidate()}});
  assert.equal((await post(first,'防脱生发洗发水 500ml')).statusCode,409);
  assert.equal((await post(first,`${sku.name} ${sku.specification}`)).statusCode,200);
  assert.equal((await post(first,`${sku.name} ${sku.specification}`)).statusCode,409);
  const second=saveDraft(2);
  assert.equal((await post(second,`${sku.name} ${sku.specification} 香氛`)).statusCode,200);
  assert.deepEqual(store.db.prepare('SELECT version,status FROM listing_contents WHERE sku_id=? ORDER BY version').all(sku.id).map(row=>[row.version,row.status]),[[1,'SUPERSEDED'],[2,'CONFIRMED']]);
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
import { briefAiSchema } from '../packages/contracts/product-intelligence.js';

test('Product Brief keeps unsupported design and user hypotheses uncited for human validation', () => {
  const cited = { text: '当前样本出现控油与蓬松组合', evidenceIds: ['11111111-1111-4111-8111-111111111111'] };
  const hypothesis = { text: '建议验证油性发质用户的使用场景', evidenceIds: [] };
  const result = briefAiSchema.safeParse({
    marketOpportunity: cited,
    targetUserAndScene: hypothesis,
    priceBand: cited,
    specification: cited,
    coreSellingPoints: [cited],
    differentiation: hypothesis,
    productDesign: hypothesis,
    risks: [cited],
    pendingValidation: ['需验证目标用户与包装设计方向'],
  });
  assert.equal(result.success, true);
});

test('Listing quality checks every slot, citations, specification and duplicate expressions',()=>{
  const facts=[{id:'product.name',type:'product_name',value:productInput.name},{id:'product.brand',type:'brand',value:'LEADR'},{id:'product.specification',type:'spec',value:'500ml'}];
  const candidate=listingCandidate();
  assert.equal(listingCandidateSchema.safeParse(candidate).success,true);
  assert.equal(listingQualityIssues({candidate,facts,product:productInput}).length,0);
  const broken={...candidate,sellingPoints:[{text:'72%保湿修复',sourceFactIds:['product.name']},{text:'72%保湿修复',sourceFactIds:['product.name']}],detailSuggestions:[{text:'500ml生发',sourceFactIds:['unconfirmed']},{text:'100ml',sourceFactIds:['product.specification']}]};
  const codes=listingQualityIssues({candidate:broken,facts,product:productInput,keywords:['香氛','香氛','控油']}).map(issue=>issue.code);
  for(const code of ['UNSUPPORTED_CLAIM','DUPLICATE_CONTENT','FACT_REFERENCE_INVALID','RISKY_CLAIM','SPECIFICATION_MISMATCH','DUPLICATE_KEYWORD','UNSUPPORTED_KEYWORD']) assert.ok(codes.includes(code),code);
  assert.equal(listingCandidateSchema.safeParse({...candidate,sellingPoints:[{text:'保湿',sourceFactIds:[]}]}).success,false);
  assert.equal(listingCandidateSchema.safeParse({...candidate,sellingPoints:Array.from({length:6},()=>candidate.sellingPoints[0])}).success,false);
  assert.equal(listingCandidateSchema.safeParse({...candidate,detailSuggestions:[{text:'a'.repeat(601),sourceFactIds:['product.name']}]}).success,false);
});

test('Listing confirmation cannot bypass detail quality and preserves draft, source and prior confirmed version',async t=>{
  const {app,store}=await createApp(mkdtempSync(join(tmpdir(),'commerce-listing-quality-')));t.after(()=>app.close());
  const sku=store.createProduct(productInput),time=new Date().toISOString(),runId=randomUUID(),batchId=randomUUID();
  store.db.prepare('INSERT INTO market_batches VALUES (?,?,?,?,?,?,?,?,?)').run(batchId,'来源样本','人工采集','淘宝','2026-09-01','2026-09-02','榜单数值','条',time);
  store.db.prepare('INSERT INTO ai_inference_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(runId,'seo_listing','TEXT_REASONING','sku',sku.id,'bailian','fixture-model',null,'hash','{}','{}','SUCCEEDED',1,null,null,null,time);
  const save=(version:number,suggestions:unknown)=>{const id=randomUUID();store.db.prepare('INSERT INTO listing_contents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,sku.id,'taobao',version,'DRAFT',runId,`${sku.name} 500ml`,'[]',JSON.stringify(suggestions),'[]',time,null);return id;};
  const suggestions={...listingCandidate(),sourceBatchId:batchId,scopeNote:'仅代表当前样本'};
  const first=save(1,suggestions),second=save(2,suggestions),legacy=save(3,{});
  const post=(id:string,content:unknown)=>app.inject({method:'POST',url:`/api/listing-contents/${id}/confirm`,headers,payload:{title:`${sku.name} 500ml`,titleFactIds:listingCandidate().titles[0]!.sourceFactIds,keywords:['香氛'],suggestions:content}});
  assert.equal((await post(first,suggestions)).statusCode,200);
  for(const change of [
    {detailSuggestions:[{text:'生发治疗',sourceFactIds:['product.name']}]},
    {detailSuggestions:[{text:'净含量100ml',sourceFactIds:['product.specification']}]},
    {sellingPoints:[{text:'香氛',sourceFactIds:['unconfirmed']}]},
    {suggestedKeywords:[{term:'控油',sourceFactIds:['product.name'],marketEntryIds:[]}]},
    {suggestedKeywords:[{term:'香氛',sourceFactIds:[],marketEntryIds:[randomUUID()]}]},
  ]) {
    const result=await post(second,{...suggestions,...change});
    assert.equal(result.statusCode,409,result.body);
    assert.equal(store.db.prepare('SELECT status FROM listing_contents WHERE id=?').get(second)!.status,'DRAFT');
    assert.equal(store.db.prepare('SELECT status FROM listing_contents WHERE id=?').get(first)!.status,'CONFIRMED');
  }
  assert.equal((await post(second,{...suggestions,detailSuggestions:['自由文本绕过']})).statusCode,400);
  assert.equal((await post(legacy,suggestions)).statusCode,409);
  const valid=await post(second,{...suggestions,sourceBatchId:randomUUID(),scopeNote:'篡改范围'});
  assert.equal(valid.statusCode,200,valid.body);
  assert.equal(valid.json().suggestions.sourceBatchId,batchId);
  assert.equal(valid.json().suggestions.scopeNote,suggestions.scopeNote);
  assert.ok(valid.json().factRefs.includes('product.specification'));
  const restored=await app.inject({method:'GET',url:`/api/products/${sku.id}/listing-contents`,headers});
  assert.equal(restored.statusCode,200);
  assert.equal(restored.json().find((item:{id:string})=>item.id===second).suggestions.detailSuggestions[0].text,'单瓶净含量500ml');
  assert.equal(restored.json().find((item:{id:string})=>item.id===legacy).qualityIssues[0].code,'CITED_CONTENT_REQUIRED');
  assert.equal(listingContentSchema.safeParse(valid.json().suggestions).success,true);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('vision inspection accepts a decodable legacy JPG without the final marker',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'commerce-v11-vision-')),{app,store}=await createApp(directory);t.after(()=>app.close());
  const jpeg=await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).jpeg().toBuffer();
  writeFileSync(join(directory,'legacy.jpg'),jpeg.subarray(0,-2));
  const dataUrl=await imageAt(store,'legacy.jpg');
  assert.match(dataUrl,/^data:image\/jpeg;base64,/);
  const normalized=Buffer.from(dataUrl.split(',')[1]!,'base64');
  assert.equal(normalized.subarray(-2).toString('hex'),'ffd9');
});
