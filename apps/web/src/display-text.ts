export function cleanDisplayText(value: string): string {
  return value.replace(/\s*[（(]用户提供[）)]/g, '').trim();
}

export function factDisplayValue(fact: { type: string; value: string }): string {
  return fact.type === 'asset' ? '已上传商品素材' : cleanDisplayText(fact.value);
}

export function sourceDisplayLabel(value: string): string {
  if (/用户在当前任务提供|用户提供/.test(value)) return '产品资料';
  return cleanDisplayText(value);
}

export function opportunityDisplayTitle(title: string): string {
  return title.replace(/^(待审核|分析草稿|已否决)[：:]\s*/, '').replace(/\s*待(?:人工)?审核$/, '').trim();
}

export function batchDisplayName(name: string | undefined): string {
  return name?.replace(/\s*·\s*(?:监控\s+)?jd_?ui_?[0-9a-f]+\b/gi, '').trim() || '未命名批次';
}

export function joinBusinessNotes(parts: string[]): string {
  return [...new Set(parts.map(part=>part.trim().replace(/[。；;\s]+$/u,'')).filter(Boolean))].join('；');
}

export function marketSourceLabel(platform:string,source:string):string {
  const label=source.replace(/[；;·]\s*仅代表当前样本.*$/u,'').trim();
  return joinBusinessNotes([platform,label===platform?'':label]);
}

export function businessNotes(value:string):string {
  return cleanDisplayText(value.replace(/(?:当前)?仅用于本地工作流程试点[。；;]?/gu,''));
}

export const contentRevisionLabel=(version:number)=>`方案修订记录 #${version}`;
