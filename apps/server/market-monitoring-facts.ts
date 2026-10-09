import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Store } from './store.js';
import type { MarketRow, SourceMetadata } from '../../packages/contracts/market.js';

const terms=['控油','蓬松','去屑','柔顺','滋养','修护','留香','清爽','止痒','强韧','氨基酸','香氛'];
type Item={id:string;sourceProductId:string|null;data:MarketRow;metadata:SourceMetadata};
export type Distribution={name:string;count:number};
export type SnapshotFacts={sampleSize:number;medianPrice:number|null;priceBands:Distribution[];brands:Distribution[];shops:Distribution[];keywords:Distribution[];coverage:Record<string,number>;couponStatus:'UNVERIFIED';itemIdentity:'UNRELIABLE'};
export type SnapshotFilter={priceMin?:number;priceMax?:number;keyword?:string;brand?:string;shop?:string};
export type AggregateChange={key:string;type:string;label:string;before:number;after:number;delta:number;evidenceEntryIds:string[]};
export type SignalRules={sampleDelta:number;medianPriceDelta:number;medianPriceRatio:number;distributionDelta:number;distributionSampleRatio:number};
export function monitorSignalRules(environment:NodeJS.ProcessEnv=process.env):SignalRules{
  const number=(name:string,fallback:number)=>{const raw=environment[name];const value=raw===undefined?fallback:Number(raw);if(!Number.isFinite(value)||value<0||value>1000)throw new Error(`${name} must be a non-negative number up to 1000`);return value};
  return {sampleDelta:number('COMMERCE_MONITOR_SAMPLE_DELTA',3),medianPriceDelta:number('COMMERCE_MONITOR_MEDIAN_PRICE_DELTA',5),medianPriceRatio:number('COMMERCE_MONITOR_MEDIAN_PRICE_RATIO',0.1),distributionDelta:number('COMMERCE_MONITOR_DISTRIBUTION_DELTA',3),distributionSampleRatio:number('COMMERCE_MONITOR_DISTRIBUTION_RATIO',0.08)};
}

function original(item:Item):Record<string,unknown>|null{
  const path=item.metadata.raw_snapshot_path;
  if(!path||!existsSync(path))return null;
  const bytes=readFileSync(path);
  if(item.metadata.raw_snapshot_hash&&createHash('sha256').update(bytes).digest('hex')!==item.metadata.raw_snapshot_hash)return null;
  try{return JSON.parse(bytes.toString('utf8')) as Record<string,unknown>}catch{return null}
}
function sourceNumber(item:Item,key:keyof SourceMetadata,rawPath:string[]):number|null{
  const stored=item.metadata[key];
  if(typeof stored==='number'&&Number.isFinite(stored))return stored;
  let value:unknown=original(item);
  for(const part of rawPath)value=value&&typeof value==='object'?(value as Record<string,unknown>)[part]:undefined;
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}
function count(values:string[]):Distribution[]{const result=new Map<string,number>();for(const value of values){if(value)result.set(value,(result.get(value)??0)+1)}return [...result].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));}
function items(store:Store,batchId:string):Item[]{return store.db.prepare('SELECT id,source_product_id,normalized_data,source_metadata FROM market_entries WHERE batch_id=? ORDER BY row_number').all(batchId).map(row=>({id:String(row.id),sourceProductId:row.source_product_id?String(row.source_product_id):null,data:JSON.parse(String(row.normalized_data)) as MarketRow,metadata:JSON.parse(String(row.source_metadata)) as SourceMetadata}));}
export function snapshotFacts(store:Store,batchId:string,filter:SnapshotFilter={}):SnapshotFacts{
  const rows=items(store,batchId).filter(row=>{
    const price=sourceNumber(row,'source_price',['priceInfo','price']);
    return (filter.priceMin===undefined||price!==null&&price>=filter.priceMin)
      &&(filter.priceMax===undefined||price!==null&&price<=filter.priceMax)
      &&(!filter.keyword||(row.data.title+row.data.sellingPoints).includes(filter.keyword))
      &&(!filter.brand||row.data.brand===filter.brand)
      &&(!filter.shop||row.data.shop===filter.shop);
  }),prices=rows.map(row=>sourceNumber(row,'source_price',['priceInfo','price'])).filter((price):price is number=>price!==null).sort((a,b)=>a-b);
  const median=prices.length?prices.length%2?prices[(prices.length-1)/2]!:(prices[prices.length/2-1]!+prices[prices.length/2]!)/2:null;
  const bands=[{name:'30元以下',count:0},{name:'30–49元',count:0},{name:'50–99元',count:0},{name:'100元及以上',count:0}];
  for(const price of prices)bands[price<30?0:price<50?1:price<100?2:3]!.count++;
  const keywords=count(rows.flatMap(row=>terms.filter(term=>(row.data.title+row.data.sellingPoints).includes(term))));
  const present=(predicate:(row:Item)=>boolean)=>rows.filter(predicate).length;
  return {sampleSize:rows.length,medianPrice:median,priceBands:bands,brands:count(rows.map(row=>row.data.brand)),shops:count(rows.map(row=>row.data.shop)),keywords,
    coverage:{itemId:present(row=>!!row.sourceProductId),title:present(row=>!!row.data.title),price:prices.length,brand:present(row=>!!row.data.brand),shop:present(row=>!!row.data.shop),image:present(row=>!!row.metadata.main_image_url),comments:present(row=>sourceNumber(row,'source_comment_count',['comments'])!==null),allianceOrders:present(row=>sourceNumber(row,'source_metric_raw',['inOrderCount30DaysSku'])!==null),commission:present(row=>sourceNumber(row,'source_commission',['commissionInfo','commission'])!==null),couponList:present(row=>!!row.metadata.source_coupons?.length||!!(original(row)?.couponInfo as {couponList?:unknown[]}|undefined)?.couponList?.length)},
    couponStatus:'UNVERIFIED',itemIdentity:'UNRELIABLE'};
}
function distributionChanges(before:Distribution[],after:Distribution[],type:string,label:string,beforeSize:number,afterSize:number,threshold:number):AggregateChange[]{
  const old=new Map(before.map(item=>[item.name,item.count])),current=new Map(after.map(item=>[item.name,item.count]));
  return [...new Set([...old.keys(),...current.keys()])].map(name=>{const a=old.get(name)??0,b=current.get(name)??0;return {key:`${type}:${name}`,type,label:`${label}「${name}」`,before:a,after:b,delta:b-a,evidenceEntryIds:[]};}).filter(change=>Math.abs(change.delta)>=threshold&&Math.abs(change.after/Math.max(afterSize,1)-change.before/Math.max(beforeSize,1))>=0.08).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8);
}
export function aggregateChanges(before:SnapshotFacts,after:SnapshotFacts):AggregateChange[]{
  const changes:AggregateChange[]=[];
  if(before.sampleSize!==after.sampleSize)changes.push({key:'sample-size',type:'SAMPLE_SIZE_CHANGED',label:'有效样本数',before:before.sampleSize,after:after.sampleSize,delta:after.sampleSize-before.sampleSize,evidenceEntryIds:[]});
  if(before.medianPrice!==null&&after.medianPrice!==null&&before.medianPrice!==after.medianPrice)changes.push({key:'median-price',type:'MEDIAN_PRICE_CHANGED',label:'样本价格中位数（元）',before:before.medianPrice,after:after.medianPrice,delta:after.medianPrice-before.medianPrice,evidenceEntryIds:[]});
  for(const [label,a,b,type,threshold] of [['价格带',before.priceBands,after.priceBands,'PRICE_BAND_CHANGED',2],['品牌',before.brands,after.brands,'BRAND_STRUCTURE_CHANGED',2],['店铺',before.shops,after.shops,'SHOP_STRUCTURE_CHANGED',2],['关键词',before.keywords,after.keywords,'KEYWORD_DISTRIBUTION_CHANGED',2]] as const)changes.push(...distributionChanges(a,b,type,label,before.sampleSize,after.sampleSize,threshold));
  return changes;
}
export function signalChanges(changes:AggregateChange[],beforeSize:number,rules:SignalRules=monitorSignalRules()):AggregateChange[]{return changes.filter(change=>change.type==='SAMPLE_SIZE_CHANGED'?Math.abs(change.delta)>=rules.sampleDelta:change.type==='MEDIAN_PRICE_CHANGED'?Math.abs(change.delta)>=rules.medianPriceDelta&&Math.abs(change.delta)/Math.max(change.before,1)>=rules.medianPriceRatio:Math.abs(change.delta)>=rules.distributionDelta&&Math.abs(change.delta)/Math.max(beforeSize,1)>=rules.distributionSampleRatio);}
