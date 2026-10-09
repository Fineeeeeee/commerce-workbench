export type StatusTone = 'neutral' | 'action' | 'running' | 'confirmed' | 'error' | 'unknown';
export type StatusIcon = 'dot' | 'attention' | 'queue' | 'processing' | 'check' | 'error' | 'timeout' | 'unknown';
export type StatusDefinition = { label: string; tone: StatusTone; icon: StatusIcon; detail?: string };
const status = (label: string, tone: StatusTone, icon?: StatusIcon, detail?: string): StatusDefinition => ({
  label, tone, icon: icon ?? ({ neutral: 'dot', action: 'attention', running: 'processing', confirmed: 'check', error: 'error', unknown: 'unknown' } as const)[tone], ...(detail ? { detail } : {}),
});
const version = { DRAFT: status('待确认', 'action'), CONFIRMED: status('已确认', 'confirmed'), SUPERSEDED: status('历史版本', 'neutral') };
const tasks = {
  QUEUED: status('排队中', 'running', 'queue'), RUNNING: status('处理中', 'running'),
  WAITING_EXTERNAL: status('处理中', 'running', 'processing', '等待模型结果'),
  SAVING_RESULT: status('处理中', 'running', 'processing', '正在保存结果'),
  NEEDS_RECONCILIATION: status('待核实', 'action'), SUCCEEDED: status('已完成', 'confirmed'),
  FAILED: status('失败', 'error'), CANCELLED: status('已取消', 'neutral'),
  TIMEOUT: status('超时', 'error', 'timeout'), TIMED_OUT: status('超时', 'error', 'timeout'),
};
const research = {
  CREATED: status('已创建', 'neutral'), COLLECTING: status('采集中', 'running'),
  NORMALIZING: status('数据处理中', 'running', 'processing', '整理数据'),
  IMPORTING: status('数据处理中', 'running', 'processing', '保存数据'),
  ANALYZING: status('AI分析中', 'running'), REVIEW_REQUIRED: status('待审核', 'action'),
  COMPLETED: status('已完成', 'confirmed'), FAILED: status('失败', 'error'),
};

/** Display vocabulary only. No transition, eligibility, or task recovery rules belong here. */
export const statusCatalog = {
  project: {
    DRAFT: status('草稿', 'neutral'), EVALUATING: status('评估中', 'neutral'), APPROVED: status('已立项', 'confirmed'),
    DEVELOPING: status('开发中', 'neutral'), READY: status('待上市', 'action'), LAUNCHED: status('已上市', 'confirmed'), CLOSED: status('已关闭', 'neutral'),
  },
  spu: { DRAFT: status('草稿', 'neutral'), ACTIVE: status('使用中', 'neutral'), RETIRED: status('已停用', 'neutral') },
  template: { ACTIVE: status('已启用', 'neutral'), INACTIVE: status('已停用', 'neutral') },
  claim: { PROVIDED: status('待核实', 'action'), PENDING: status('待核实', 'action'), APPROVED: status('已确认', 'confirmed') },
  research,
  monitoring: {
    CREATED: status('等待采集', 'neutral'), COLLECTING: research.COLLECTING, NORMALIZING: research.NORMALIZING,
    IMPORTING: research.IMPORTING, DETECTING: status('计算变化中', 'running'),
    COMPLETED: research.COMPLETED, PARTIAL: status('采集不完整', 'error'), FAILED: research.FAILED,
  },
  opportunity: { DRAFT: status('待审核', 'action'), READY: status('已通过', 'confirmed'), REJECTED: status('已否决', 'neutral') },
  opportunityReview: { APPROVED: status('已通过', 'confirmed'), REJECTED: status('已否决', 'neutral') },
  signal: { OPEN: status('待查看', 'action'), REVIEWED: status('已查看', 'neutral') },
  brief: version, listing: version, visualGuide: version, imageTypeGuide: version,
  contentPage: {
    READY: status('可制作', 'neutral'), MISSING_DATA: status('缺资料', 'error'), GENERATING: status('生成中', 'running'),
    GENERATED: status('待审核', 'action'), REVIEWED: status('已审核', 'confirmed'), FAILED: status('生成失败', 'error'),
  },
  copy: { DRAFT: status('待确认', 'action'), CONFIRMED: status('已确认', 'confirmed') },
  ruleCheck: { PASS: status('通过', 'confirmed'), FAIL: status('未通过', 'error') },
  aiCheck: {
    NOT_RUN: status('尚未检查', 'neutral'), PASS: status('未发现明显问题', 'neutral'),
    REVIEW: status('建议复核', 'action'), FAILED: status('检查失败', 'error'),
  },
  humanReview: { PENDING: status('待审核', 'action'), APPROVE: status('通过', 'confirmed'), REJECT: status('已退回', 'action') },
  task: tasks,
  // ACTIVE is a job aggregate; RUNNING is a task state. This is not a state-machine merge.
  job: { ...tasks, ACTIVE: status('处理中', 'running', 'processing', '任务汇总：包含正在处理的任务'), PARTIAL: status('部分完成', 'action') },
  export: { RUNNING: tasks.RUNNING, SUCCEEDED: tasks.SUCCEEDED, FAILED: tasks.FAILED },
  workItem: { OPEN: status('待处理', 'action'), IN_PROGRESS: status('进行中', 'neutral'), COMPLETED: status('已完成', 'confirmed'), CANCELED: status('已取消', 'neutral') },
  queue: {
    '失败': tasks.FAILED, '生成失败': status('生成失败', 'error'), '调用失败': status('调用失败', 'error'), '超时': tasks.TIMEOUT,
    FAILED: tasks.FAILED, TIMEOUT: tasks.TIMEOUT, TIMED_OUT: tasks.TIMEOUT,
    '待审核': status('待审核', 'action'), '待完成': status('待完成', 'action'), '待查看': status('待查看', 'action'), '待核对': status('待核对', 'action'), '可制作': status('可制作', 'neutral'),
    '领导指派': status('领导指派', 'action'), '待处理': status('待处理', 'action'), '进行中': status('进行中', 'neutral'),
    '草稿': status('草稿', 'neutral'), '评估中': status('评估中', 'neutral'), '已立项': status('已立项', 'confirmed'), '开发中': status('开发中', 'neutral'), '待上市': status('待上市', 'action'), '已上市': status('已上市', 'confirmed'), '已关闭': status('已关闭', 'neutral'),
    OPEN: status('待处理', 'action'), IN_PROGRESS: status('进行中', 'neutral'), COMPLETED: tasks.SUCCEEDED, CANCELED: tasks.CANCELLED,
  },
  inference: { SUCCEEDED: status('调用完成', 'neutral'), FAILED: status('调用失败', 'error'), UNCERTAIN: status('待核实', 'action') },
  modelEvaluation: { PREFER: status('倾向采用', 'confirmed'), DO_NOT_USE: status('不采用', 'neutral'), NEEDS_REVIEW: status('待复核', 'action') },
  delivery: { DRAFT: status('草稿', 'neutral'), DELIVERED: status('已交付', 'confirmed'), WITHDRAWN: status('已撤回', 'neutral') },
} satisfies Record<string, Record<string, StatusDefinition>>;
export type StatusDomain = keyof typeof statusCatalog;
export type StatusEnvironment = 'development' | 'test' | 'production';

export function resolveStatus(domain: StatusDomain, value: string | null, environment: StatusEnvironment): StatusDefinition {
  const definitions: Record<string, StatusDefinition> = statusCatalog[domain];
  const key = value === null ? (domain === 'humanReview' ? 'PENDING' : '') : value.toUpperCase();
  const definition = definitions?.[key];
  if (definition) return definition;
  if (environment !== 'production') throw new Error(`Unmapped status: ${domain}/${value}`);
  return status('状态异常', 'unknown', 'unknown', `${domain}: ${value}`);
}

export const statusTerminology = {
  confirmation: '待确认：采用候选或版本，如企划、Listing、文案。',
  review: '待审核：对已有内容作出通过或退回决定，如机会、内容页、样本。',
  exclusions: '历史检索结果和样本核对结论使用中性文字，不进入状态颜色体系。',
} as const;
