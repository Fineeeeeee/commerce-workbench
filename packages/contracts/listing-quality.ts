import type { ListingCandidate } from './product-intelligence.js';

export type ListingFact = { id: string; type: string; value: string };
export type ListingQualityIssue = { path: string; code: string; message: string };
const normalize = (value: string) => value.toLowerCase().replace(/\s+/gu, '');
const risky = /防脱|生发|治疗|根治|零刺激|绝对安全|100%有效|\d+天见效/gu;
const claims = /控油|去屑|保湿|蓬松|修复|强韧|抗菌|无添加|留香|专利|认证|检测|临床|实验|\d+(?:\.\d+)?%/gu;
const quantities = /\d+(?:\.\d+)?\s*(?:ml|毫升|升|kg|公斤|克|g|l)(?![a-z])/giu;

// These are deterministic checks, not proof that every paraphrase is supported.
export function listingQualityIssues(input: {
  candidate: ListingCandidate;
  facts: ListingFact[];
  product: { name: string; brand: string; specification: string };
  title?: string;
  titleFactIds?: string[];
  keywords?: string[];
}): ListingQualityIssue[] {
  const issues: ListingQualityIssue[] = [], facts = new Map(input.facts.map(fact => [fact.id, fact]));
  const add = (path: string, code: string, message: string) => issues.push({path, code, message});
  const check = (text: string, ids: string[], path: string) => {
    const limit=path.startsWith('sellingPoints.')?80:path.startsWith('titles.')||path==='title'?160:600;
    if(!text.trim()||text.length>limit) add(path,'SLOT_LENGTH_INVALID',`文案不能为空且最多${limit}字（本系统槽位限制）`);
    if (!ids.length || ids.some(id => !facts.has(id))) add(path, 'FACT_REFERENCE_INVALID', '需要引用当前已确认商品事实');
    const support = ids.map(id => facts.get(id)?.value ?? '').join('；');
    if (text.match(risky)) add(path, 'RISKY_CLAIM', '含高风险功效或保证性表述，请删除并重新核对');
    for (const term of new Set(text.match(claims) ?? [])) {
      if (!normalize(support).includes(normalize(term))) add(path, 'UNSUPPORTED_CLAIM', `“${term}”缺少所引用商品事实依据`);
    }
    for (const quantity of text.match(quantities) ?? []) {
      if (!normalize(support).includes(normalize(quantity))) add(path, 'SPECIFICATION_MISMATCH', `“${quantity}”与所引用事实不符`);
    }
  };
  const titleCheck = (text: string, ids: string[], path: string) => {
    check(text, ids, path);
    for (const [label, value] of [['商品名', input.product.name], ['品牌', input.product.brand], ['规格', input.product.specification]]) {
      if (value && !normalize(text).includes(normalize(value))) add(path, 'IDENTITY_MISSING', `缺少已确认${label}`);
    }
  };
  input.candidate.titles.forEach((title, index) => {
    titleCheck(title.text, title.sourceFactIds, `titles.${index}`);
    for (const term of title.keywordTerms) {
      if (!normalize(title.text).includes(normalize(term))) add(`titles.${index}`, 'KEYWORD_NOT_IN_TITLE', `关键词“${term}”未出现在该标题`);
      check(term, title.sourceFactIds, `titles.${index}`);
    }
  });
  const slots = [...input.candidate.sellingPoints.map((slot, i) => ({...slot, path:`sellingPoints.${i}`})), ...input.candidate.detailSuggestions.map((slot, i) => ({...slot, path:`detailSuggestions.${i}`}))];
  slots.forEach(slot => check(slot.text, slot.sourceFactIds, slot.path));
  for (const group of [input.candidate.sellingPoints, input.candidate.detailSuggestions]) {
    const seen = new Set<string>();
    group.forEach(slot => {const key=normalize(slot.text); if (seen.has(key)) add('content', 'DUPLICATE_CONTENT', '同一组文案存在重复表达'); seen.add(key);});
  }
  input.candidate.suggestedKeywords.forEach((keyword, i) => {
    if (keyword.sourceFactIds.length) {
      check(keyword.term, keyword.sourceFactIds, `suggestedKeywords.${i}`);
      if(!keyword.sourceFactIds.some(id=>normalize(facts.get(id)?.value??'').includes(normalize(keyword.term)))) add(`suggestedKeywords.${i}`,'UNSUPPORTED_KEYWORD',`“${keyword.term}”不在所引用商品事实中`);
    }
  });
  if (input.title !== undefined) titleCheck(input.title, input.titleFactIds ?? [], 'title');
  for (const term of input.keywords ?? []) {
    const supported = input.facts.some(fact => normalize(fact.value).includes(normalize(term)));
    if (!supported || term.match(risky)) add('keywords', 'UNSUPPORTED_KEYWORD', `关键词“${term}”缺少当前商品事实依据`);
  }
  if (new Set((input.keywords ?? []).map(normalize)).size !== (input.keywords ?? []).length) add('keywords', 'DUPLICATE_KEYWORD', '关键词重复');
  return issues;
}

export function listingFactReferences(candidate: ListingCandidate) {
  return [...new Set([...candidate.titles.flatMap(item => item.sourceFactIds), ...candidate.sellingPoints.flatMap(item => item.sourceFactIds), ...candidate.detailSuggestions.flatMap(item => item.sourceFactIds), ...candidate.suggestedKeywords.flatMap(item => item.sourceFactIds)])];
}
