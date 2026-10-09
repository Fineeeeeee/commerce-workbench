import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageLoading, InlineError, EmptyState } from '../apps/web/src/components/states.js';
import { designEnhancedDraft } from '../packages/contracts/image-type-design.js';
import { imageTypeDrafts } from '../packages/contracts/image-type-catalog.js';
import { imageTypeDataSchema } from '../packages/contracts/image-type-guide.js';
import { elapsedLabel } from '../packages/contracts/task-presentation.js';
import { AsyncBoundary } from '../apps/web/src/components/states.js';
import { historicalProductInput } from '../apps/web/src/product-history-panel.js';
import { Store } from '../apps/server/store.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, ApiError, peekApi, json } from '../apps/web/src/api.js';
import { createApp } from '../apps/server/app.js';
import { uploadAsset } from '../apps/server/media.js';
import sharp from 'sharp';
import { HelpHint } from '../apps/web/src/components/help-hint.js';

test('optional metric help is named and does not expand explanations by default',()=>{
  const html=renderToStaticMarkup(<HelpHint label="价格统计口径">按当前样本计算</HelpHint>);
  assert.match(html,/aria-label="价格统计口径"/);assert.ok(!html.includes('按当前样本计算'));assert.ok(!html.includes('role="tooltip"'));
});

test('shared loading communicates structure without an indefinite spinner',()=>{
  const html=renderToStaticMarkup(<PageLoading>读取商品资料</PageLoading>);
  assert.match(html,/aria-busy="true"/);assert.match(html,/block-skeleton/);assert.match(html,/读取商品资料/);assert.ok(!html.includes('spin'));
});
test('error retry and empty guidance are explicit accessible states',()=>{
  assert.match(renderToStaticMarkup(<InlineError onRetry={()=>{}}>连接失败</InlineError>),/重新加载/);
  assert.match(renderToStaticMarkup(<EmptyState title="暂无素材" desc="上传商品图" action={<button>上传图片</button>}/>),/上传图片/);
});
test('design enhancement creates an editable proposal without mutating confirmed knowledge',()=>{
  const original=imageTypeDrafts.find(item=>item.slotId==='F01')!.data;
  const before=JSON.stringify(original),proposal=designEnhancedDraft('F01',original);
  assert.equal(JSON.stringify(original),before);imageTypeDataSchema.parse(proposal);
  assert.match(proposal.textOverlayRule,/逐字保留/);assert.match(proposal.backgroundRule,/花影/);
  assert.deepEqual(proposal.mustNotShow,original.mustNotShow);
});
test('task time uses observed timestamps and never invents an estimate',()=>{
  assert.equal(elapsedLabel('2026-10-05T00:00:00Z','2026-10-05T00:01:05Z'),'1 分 5 秒');
  assert.equal(elapsedLabel('invalid',new Date().toISOString()),'用时待核实');
  assert.equal(elapsedLabel('2026-10-05T00:00:20Z','2026-10-05T00:00:10Z'),'用时待核实');
});
test('async boundary renders one state and errors take precedence over loading',()=>{
  const html=renderToStaticMarkup(<AsyncBoundary loading error="连接失败" onRetry={()=>{}}><p>已载入</p></AsyncBoundary>);
  assert.match(html,/连接失败/);assert.match(html,/重新加载/);assert.ok(!html.includes('block-skeleton'));assert.ok(!html.includes('已载入'));
});
test('restoring SKU facts appends a version and rejects a stale second submission',async()=>{
  const store=new Store(await mkdtemp(join(tmpdir(),'commerce-history-')));
  try{
    const original=store.createProduct({name:'历史验证商品',brand:'TEST',specification:'500ml',variant:'',audience:'',origin:'',notes:'原资料',claims:[]});
    const updated=store.saveProduct(original.id,original.version,{...historicalProductInput(original),notes:'新资料'});
    const restored=store.saveProduct(original.id,updated.version,historicalProductInput(store.product(original.id,1)));
    assert.equal(restored.version,3);assert.equal(restored.id,original.id);assert.equal(restored.spuId,original.spuId);assert.equal(restored.notes,'原资料');
    assert.equal(store.product(original.id,2).notes,'新资料');
    assert.throws(()=>store.saveProduct(original.id,updated.version,historicalProductInput(original)),/其他窗口更新/);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{store.close();}
});
test('mutation feedback is shared; read retries never toast or replay a mutation',async()=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  const target=new EventTarget(),feedback:string[]=[];let calls=0;
  target.addEventListener('workspace-operation-feedback',event=>feedback.push((event as CustomEvent<{tone:string}>).detail.tone));
  globalThis.window=target as unknown as Window & typeof globalThis;
  try{
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true}),{status:200});};
    await api('/test',{method:'PUT'});assert.deepEqual(feedback,['success']);
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{message:'版本冲突',code:'VERSION_CONFLICT'}}),{status:409});};
    await assert.rejects(api('/test',{method:'PUT'}),error=>error instanceof ApiError&&error.code==='VERSION_CONFLICT');
    assert.deepEqual(feedback,['success','error']);
    await assert.rejects(api('/test'));assert.equal(feedback.length,2);assert.equal(calls,3);
  }finally{globalThis.window=previousWindow;globalThis.fetch=previousFetch;}
});
test('navigation snapshots refresh normally and cannot be repopulated by a pre-write read',async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({version:calls}),{status:200});};
    await api('/snapshot-test');assert.deepEqual(peekApi('/snapshot-test'),{version:1});
    await api('/snapshot-test');assert.equal(calls,2);assert.deepEqual(peekApi('/snapshot-test'),{version:2});
    let release!:(response:Response)=>void;
    globalThis.fetch=async(_url,options)=>options?.method==='PUT'?new Response('{}',{status:200}):new Promise<Response>(resolve=>{release=resolve;});
    const pending=api('/snapshot-test');await api('/snapshot-test',json({},'PUT'));
    assert.equal(peekApi('/snapshot-test'),null);release(new Response('{"version":0}',{status:200}));await pending;
    assert.equal(peekApi('/snapshot-test'),null);
  } finally {globalThis.fetch=originalFetch;}
});
test('list previews are bounded thumbnails while original material stays byte-identical',async()=>{
  const {app,store}=await createApp(await mkdtemp(join(tmpdir(),'commerce-preview-')));
  try{
    const product=store.createProduct({name:'预览验证商品',brand:'TEST',specification:'500ml',variant:'',audience:'',origin:'',notes:'',claims:[]});
    const original=await sharp({create:{width:1200,height:800,channels:3,background:'#d5e8ef'}}).png().toBuffer();
    const asset=await uploadAsset(store,product.id,original,'preview.png','自动化测试');
    const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'};
    const preview=await app.inject({url:`/api/assets/${asset.id}/content?preview=1`,headers});
    assert.equal(preview.statusCode,200);assert.match(preview.headers['content-type'] as string,/image\/webp/);
    const metadata=await sharp(preview.rawPayload).metadata();assert.ok(metadata.width!<=400&&metadata.height!<=400);
    const full=await app.inject({url:`/api/assets/${asset.id}/content`,headers});assert.deepEqual(full.rawPayload,original);
  }finally{await app.close();}
});
