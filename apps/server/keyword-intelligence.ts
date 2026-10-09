import type { Store } from './store.js';
import { AppError } from './store.js';
import { facialCleanserSellingPointGroups, sellingPointGroups } from '../../packages/contracts/market-opportunity.js';
import { hydrateMarketRow } from '../../packages/contracts/market.js';

export function keywordIntelligence(store: Store, batchId: string) {
  const batch = store.db.prepare('SELECT id,name,platform,source,period_start,period_end FROM market_batches WHERE id=?').get(batchId);
  if (!batch) throw new AppError('NOT_FOUND','市场批次不存在',404);
  const rows=store.db.prepare('SELECT id,normalized_data FROM market_entries WHERE batch_id=? ORDER BY row_number').all(batchId);
  if(!rows.length)throw new AppError('NO_ENTRIES','当前批次没有商品记录',409);
  const valid=rows.map(row=>({id:String(row.id),data:hydrateMarketRow(JSON.parse(String(row.normalized_data)))})).filter(entry=>entry.data.title.trim());
  const prices=valid.map(entry=>entry.data.price).filter((price):price is number=>price!==null).sort((a,b)=>a-b);
  const middle=Math.floor(prices.length/2);
  const medianPrice=prices.length ? Number((prices.length%2?prices[middle]!:(prices[middle-1]!+prices[middle]!)/2).toFixed(2)) : null;
  const specificationCounts=new Map<string,number>();
  valid.forEach(entry=>{const value=entry.data.specification.trim();if(value)specificationCounts.set(value,(specificationCounts.get(value)??0)+1);});
  const research=store.db.prepare('SELECT collection_profile FROM market_research_jobs WHERE market_batch_id=?').get(batchId);
  const groups = (research?.collection_profile==='facial_cleanser' ? facialCleanserSellingPointGroups : sellingPointGroups).map(([term,aliases]) => {
    const entries=valid.filter(entry=>aliases.some(alias=>`${entry.data.title} ${entry.data.sellingPoints}`.includes(alias)));
    const prices = entries.map(entry=>entry.data.price).filter((price):price is number=>price!==null).sort((a,b)=>a-b);
    return { term, titleCount:entries.filter(entry=>aliases.some(alias=>entry.data.title.includes(alias))).length,
      productCount:entries.length, sampleShare:valid.length ? Number((entries.length/valid.length).toFixed(4)) : 0,
      priceRange:prices.length ? { min:prices[0]!,max:prices.at(-1)! } : null,
      representativeEntries:entries.slice(0,5).map(entry=>({id:entry.id,title:entry.data.title,price:entry.data.price})),
      sourceEntryIds:entries.map(entry=>entry.id) };
  }).filter(item=>item.productCount>0).sort((a,b)=>b.productCount-a.productCount || a.term.localeCompare(b.term,'zh-CN'));
  const combinations: Array<{terms:string[];count:number;sourceEntryIds:string[]}> = [];
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
    const sourceEntryIds=groups[i]!.sourceEntryIds.filter(id=>groups[j]!.sourceEntryIds.includes(id));
    if(sourceEntryIds.length)combinations.push({terms:[groups[i]!.term,groups[j]!.term],count:sourceEntryIds.length,sourceEntryIds});
  }
  combinations.sort((a,b)=>b.count-a.count);
  const rawTermMap=new Map<string,Set<string>>();
  for(const entry of valid)for(const term of entry.data.sellingPoints.split(/[\s,，、;；|/]+/).map(value=>value.trim()).filter(value=>value.length>=2&&value.length<=40)){
    const ids=rawTermMap.get(term)??new Set<string>();ids.add(entry.id);rawTermMap.set(term,ids);
  }
  const rawTerms=[...rawTermMap].map(([term,ids])=>({term,productCount:ids.size,sourceEntryIds:[...ids]})).sort((a,b)=>b.productCount-a.productCount).slice(0,30);
  return { batch:{id:batchId,name:String(batch.name),platform:String(batch.platform),source:String(batch.source),periodStart:String(batch.period_start),periodEnd:String(batch.period_end)},
    sampleSize:valid.length, excludedCount:rows.length-valid.length, medianPrice, priceSampleSize:prices.length, specifications:[...specificationCounts].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count).slice(0,10), scopeNote:'仅代表当前批次中标题非空的商品样本；不按新品机会规则排除老品，不代表平台搜索量或趋势。',
    keywords:groups, combinations:combinations.slice(0,30), rawTerms };
}
