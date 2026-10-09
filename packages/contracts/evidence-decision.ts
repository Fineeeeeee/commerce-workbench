import type { ProductOpportunity } from './market-opportunity.js';
import type { Entry } from './market.js';

export function opportunityEvidence<T extends Entry>(item: ProductOpportunity, entries: T[]) {
  const candidate = item.analysis.ai?.opportunities.find(value => value.name === item.title);
  const included = new Set(item.analysis.included.map(entry => entry.id));
  const representatives = candidate?.evidence_record_ids.filter(id => included.has(id)) ?? [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const representativeIds = new Set(representatives);
  const analysisEntries = entries.filter(entry => included.has(entry.id))
    .sort((a, b) => Number(representativeIds.has(b.id)) - Number(representativeIds.has(a.id)));
  const highlightedEntries = candidate
    ? representatives.map(id => byId.get(id)).filter((entry): entry is T => !!entry)
    : analysisEntries;
  return { candidate, representativeIds, highlightedEntries, analysisEntries };
}
