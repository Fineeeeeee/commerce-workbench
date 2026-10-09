import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPages, type ProductInput } from '../packages/contracts/domain.js';
import { missingFields, productFacts, taobaoDailyCarePages } from '../packages/contracts/content-template.js';
import { copyPrompt, parseCopyJson, parseTemplateCopy, validateCopy } from '../packages/contracts/copy.js';
import { renderSvg } from '../packages/contracts/render.js';

const claimId = '11111111-1111-4111-8111-111111111111';
const product: ProductInput = { name:'LEADR溪畔幽兰香氛洗发水',brand:'LEADR',variant:'溪畔幽兰香氛',specification:'500ml',audience:'油性发质',origin:'广州',notes:'使用方法：取适量于湿发，轻柔按摩后用清水冲洗',claims:[{id:claimId,label:'清爽蓬松',text:'洗后清爽，改善扁塌体验',source:'产品确认资料',status:'approved'}] };

test('淘宝日化 5+12 定义完整且模板标识稳定', () => {
  assert.equal(taobaoDailyCarePages.length,17); assert.deepEqual(taobaoDailyCarePages.map(item=>item.id),['F01','F02','F03','F04','F05','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12']);
  assert.equal(taobaoDailyCarePages.filter(item=>item.kind==='main').length,5);
});

test('统一事实层只包含确认事实，F04/F05 缺资料时明确阻止', () => {
  const pages=createPages(product,12,'22222222-2222-4222-8222-222222222222'), facts=productFacts(product,pages[0],{targetAudience:'油性发质',positioning:'香氛洗护',coreClaims:['清爽蓬松'],dynamicAttributes:{fragrance:'溪畔幽兰',netContent:'500ml',ingredients:[]}});
  assert.ok(facts.some(f=>f.id===`claim.${claimId}`&&f.confirmed)); assert.ok(facts.some(f=>f.type==='usage'));
  assert.deepEqual(missingFields(taobaoDailyCarePages[3]!,facts),['top_notes','middle_notes','base_notes']);
  assert.deepEqual(missingFields(taobaoDailyCarePages[4]!,facts),['credential','credential_number','evidence_list:8']);
});

test('已确认的前中后调使 F04 可生成，仍不解除 F05 凭证阻断', () => {
  const page=createPages(product,12,'22222222-2222-4222-8222-222222222222')[3]!;
  const facts=productFacts(product,page,{dynamicAttributes:{topNotes:'依兰、苹果、樱花',middleNotes:'百合、鸢尾、小苍兰',baseNotes:'檀香、柏木、龙涎香'}});
  assert.deepEqual(facts.filter(fact=>['top_notes','middle_notes','base_notes'].includes(fact.type)).map(fact=>fact.value),['依兰、苹果、樱花','百合、鸢尾、小苍兰','檀香、柏木、龙涎香']);
  assert.deepEqual(missingFields(taobaoDailyCarePages[3]!,facts),[]);
  assert.deepEqual(missingFields(taobaoDailyCarePages[4]!,facts),['credential','credential_number','evidence_list:8']);
});

test('洗发水可使用类目标准用法生成 D09，非洗发水不会套用', () => {
  const input={...product,notes:''}, page=createPages(input,12,'22222222-2222-4222-8222-222222222222')[13]!;
  const shampooFacts=productFacts(input,page,{categoryCode:'shampoo',dynamicAttributes:{}});
  assert.ok(shampooFacts.some(fact=>fact.id==='category.shampoo.usage'&&fact.source==='洗发水类目使用模板'));
  assert.deepEqual(missingFields(taobaoDailyCarePages[13]!,shampooFacts),[]);
  assert.deepEqual(missingFields(taobaoDailyCarePages[13]!,productFacts(input,page,{categoryCode:'food',dynamicAttributes:{}})),['usage']);
  const prompt=copyPrompt(input,{...page,purpose:'适用发质'},[],shampooFacts);
  const payload=JSON.parse(prompt[1]!.content);
  assert.equal(payload.page.purpose,'使用方法页'); assert.match(payload.template_rule,/只允许使用 type=usage/); assert.equal(payload.output_shape.steps.length,4);
});

test('F01 结构化文案保留事实引用并通过槽位校验', () => {
  const page=createPages(product,12,'22222222-2222-4222-8222-222222222222')[0]!, facts=productFacts(product,page,{coreClaims:['清爽蓬松'],dynamicAttributes:{fragrance:'溪畔幽兰'}}), source=[`claim.${claimId}`];
  const copy=parseTemplateCopy({status:'ok',template_id:'F01',headline:'清爽蓬松',subtitle:'溪畔幽兰香氛',selling_points:[{text:'清爽不黏',source_fact_ids:source},{text:'发根蓬松',source_fact_ids:source},{text:'柔顺好梳',source_fact_ids:source}],spec:'500ml'},page,facts);
  assert.equal(copy.templateId,'F01'); assert.deepEqual(copy.evidenceIds,source); assert.ok(copy.slots?.sellingPoints); assert.equal(validateCopy(copy,product,page,facts).headline,'清爽蓬松');
});

test('文案响应只接受 JSON 对象或单层 json 代码围栏',()=>{
  assert.deepEqual(parseCopyJson('```json\n{"status":"ok"}\n```'),{status:'ok'});
  assert.throws(()=>parseCopyJson('说明如下：{"status":"ok"}'));
});

test('确定性合成在 AI 背景上仍叠加原始商品素材和中文文案', () => {
  const page={...createPages(product)[0]!,headline:'清爽蓬松',body:'清爽 · 蓬松'};
  const svg=renderSvg(page,product,'data:image/png;base64,PRODUCT','data:image/png;base64,BACKGROUND');
  assert.match(svg,/BACKGROUND/); assert.match(svg,/PRODUCT/); assert.match(svg,/清爽蓬松/);
});
