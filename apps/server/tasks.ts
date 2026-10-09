import { createHash, randomUUID } from 'node:crypto';
import { Store, AppError } from './store.js';
import { exportIssues } from './media.js';
import { jobState, type JobInput, type JobInfo, type TaskInfo } from '../../packages/contracts/tasks.js';
import type { Kit, Product } from '../../packages/contracts/domain.js';
import { copyProfile, type CopyProfile } from './copy-provider.js';
import { copyPrompt } from '../../packages/contracts/copy.js';
import type { Fact } from '../../packages/contracts/content-template.js';
import { missingFieldLabel, missingFields, templateById } from '../../packages/contracts/content-template.js';
import { factsForPage } from './content-service.js';
import { imageProfile, type ImageProfile } from './image-provider.js';
import { guideTextViolations, assembleReferencePrompt, type ReferenceVisualInput } from '../../packages/contracts/visual-guide.js';
import { confirmedVisualGuide, visualCategoryForSku } from './visual-guide.js';
import { supportsReferenceImage } from './image-provider.js';
import { imagePrompt } from '../../packages/contracts/image.js';
import { confirmedImageType } from './image-type-guide.js';

export type Snapshot = { kit: Kit; product: Product; assetHashes: Record<string, string>; rendererVersion: string; copyProfile?: CopyProfile; copyPrompts?: Record<string, { role: string; content: string }[]>; copyFacts?: Record<string, Fact[]>; copySlots?: Record<string, 'headline'|'subtitle'|'body'>; imageProfile?: ImageProfile; imagePrompts?: Record<string, string>; referenceVisualInputs?: Record<string, ReferenceVisualInput> };
export type Lease = { id: string; jobId: string; owner: string; epoch: number; attemptId: string; exportId: string; operation: string; pageId: string | null; snapshot: Snapshot };
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const nullable = (v: unknown) => v == null ? null : String(v);

export class Tasks {
  constructor(public store: Store) {}
  info(id: string): JobInfo {
    const row = this.store.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!row) throw new AppError('NOT_FOUND', '任务不存在', 404);
    const tasks: TaskInfo[] = this.store.db.prepare('SELECT * FROM tasks WHERE job_id=? ORDER BY ordinal').all(id).map(t => ({ id: String(t.id), pageId: nullable(t.page_id), state: t.state as TaskInfo['state'], stage: String(t.stage), progress: Number(t.progress), total: Number(t.total), error: nullable(t.safe_message), recoveryAction: nullable(t.recovery_action), exportId: nullable(t.export_id), updatedAt: String(t.updated_at) }));
    const snapshot = JSON.parse(String(row.input_snapshot)) as Snapshot;
    const usage = this.store.db.prepare("SELECT u.unit,SUM(u.quantity) AS quantity FROM usage_ledger u JOIN tasks t ON t.id=u.task_id WHERE t.job_id=? AND u.entry_type='settle' GROUP BY u.unit").all(id);
    const quantity = (unit: string) => { const value = usage.find(u => u.unit === unit)?.quantity; return value == null ? null : Number(value); };
    return { id, kitId: String(row.kit_id), kitVersion: Number(row.kit_version), name: snapshot.kit.name, createdAt: String(row.created_at), operation: String(row.operation), state: jobState(tasks), tasks, usage: { inputTokens: quantity('input_tokens'), outputTokens: quantity('output_tokens'), imageCount: quantity('image_count'), cost: null } };
  }
  list(kitId: string | undefined, cursor: string | undefined, limit: number) {
    let before = '';
    if (cursor) { const row = this.store.db.prepare('SELECT created_at FROM jobs WHERE id=?').get(cursor); if (!row) throw new AppError('INVALID_CURSOR', '分页位置无效'); before = String(row.created_at); }
    const rows = this.store.db.prepare('SELECT id FROM jobs WHERE (? IS NULL OR kit_id=?) AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(kitId ?? null, kitId ?? null, cursor ?? null, before, before, cursor ?? null, limit + 1);
    return { items: rows.slice(0, limit).map(r => this.info(String(r.id))), nextCursor: rows.length > limit ? String(rows[limit - 1]!.id) : null };
  }
  submit(kitId: string, body: JobInput, key: string): JobInfo {
    const scope = `submit:${kitId}`, requestHash = hash(JSON.stringify({ ...body, pageIds: [...body.pageIds].sort() }));
    const id = this.store.transaction(() => {
      const previous = this.store.db.prepare('SELECT * FROM operation_keys WHERE scope=? AND key=?').get(scope, key);
      if (previous) { if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一提交标识不能用于不同内容', 409); return String(previous.resource_id); }
      const profile = body.operation === 'copy' ? copyProfile() : body.operation === 'image' ? imageProfile(body.imageMode, body.imageModel) : null;
      if ((body.operation === 'image' || body.operation === 'copy') && !profile) throw new AppError('CONFIGURATION_MISSING', '所选生成服务尚未接入，未创建生成任务', 503);
      const kit = this.store.kit(kitId);
      if (body.operation !== 'export' && body.productionBatchId) {
        const batch = this.store.db.prepare('SELECT * FROM content_production_batches WHERE id=?').get(body.productionBatchId);
        if (!batch || batch.kit_id !== kitId || batch.sku_id !== kit.productId) throw new AppError('PRODUCTION_BATCH_MISMATCH', '生产批次与当前商品内容方案不一致', 409);
        const planned = JSON.parse(String(batch.planned_page_ids)) as string[];
        if (body.pageIds.some(pageId => !planned.includes(pageId))) throw new AppError('PRODUCTION_BATCH_MISMATCH', '所选页面不属于该生产批次', 409);
      }
      if (kit.version !== body.kitVersion) throw new AppError('VERSION_CONFLICT', '设计稿已更新，请重新读取后提交', 409);
      if (new Set(body.pageIds).size !== body.pageIds.length || body.pageIds.some(id => !kit.pages.some(p => p.id === id)) || (body.operation === 'export' && body.pageIds.length !== kit.pages.length)) throw new AppError('INVALID_PAGES', '页面选择无效；整套导出必须包含全部页面');
      const product = this.store.product(kit.productId, kit.productVersion);
      if (this.store.product(kit.productId).version !== kit.productVersion) throw new AppError('PRODUCT_CHANGED', '商品资料已更新，请同步后再生成', 409);
      if (body.operation === 'copy') {
        const selected = kit.pages.filter(p => body.pageIds.includes(p.id));
        if (!kit.spuId && selected.some(p => p.claimIds.some(id => product.claims.find(c => c.id === id)?.status !== 'approved'))) throw new AppError('CLAIMS_UNCONFIRMED', '所选页面引用了未核实卖点，请先核实或取消引用', 409);
        if (kit.spuId) for (const page of selected) { const definition = templateById(page.templateId), missing = definition ? missingFields(definition, factsForPage(this.store, product, page)) : ['template']; if (missing.length) throw new AppError('MISSING_DATA', `${definition?.id ?? page.purpose} 缺少：${missing.map(missingFieldLabel).join('、')}`, 409); }
        const count = Number(this.store.db.prepare("SELECT count(*) AS n FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.operation='copy' AND j.created_at>=?").get(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)!.n);
        if (count + selected.length > 20) throw new AppError('DAILY_LIMIT', '首轮文字试运行每日最多提交20页（UTC日期），请次日再试', 429);
        if (this.store.db.prepare("SELECT t.id FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.operation='copy' AND t.state='needs_reconciliation' LIMIT 1").get()) throw new AppError('RESULT_UNCERTAIN', '还有文字请求结果待核实，请先处理后再提交', 409);
      }
      if (body.operation === 'image') {
        const selected = kit.pages.filter(p => body.pageIds.includes(p.id));
        if (body.imageMode !== 'draft' && selected.some(p => !p.assetId)) throw new AppError('IMAGE_INPUT_MISSING', '高质量生图页面必须先选择商品参考图', 409);
        if (kit.spuId) for (const page of selected) { const definition = templateById(page.templateId), missing = definition ? missingFields(definition, factsForPage(this.store, product, page)) : ['template']; if (missing.length) throw new AppError('MISSING_DATA', `${definition?.id ?? page.purpose} 缺少：${missing.map(missingFieldLabel).join('、')}`, 409); if (page.copyStatus !== 'confirmed') throw new AppError('COPY_NOT_CONFIRMED', `${definition?.id ?? page.purpose} 的文案尚未人工确认`, 409); }
        const count = Number(this.store.db.prepare("SELECT count(*) AS n FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.operation='image' AND j.created_at>=?").get(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)!.n);
        if (count + selected.length > 20) throw new AppError('DAILY_LIMIT', '首轮图片试运行每日最多提交20页（UTC日期），请次日再试', 429);
      }
      const referenceVisualInputs: Record<string,ReferenceVisualInput> = {};
      if(body.operation==='image'&&['quality','premium'].includes(body.imageMode)&&profile){
        if(!supportsReferenceImage((profile as ImageProfile).model))throw new AppError('IMAGE_MODEL_INCOMPATIBLE','所选模型不支持参考图生成，请在模型设置选择已支持的参考编辑模型',409);
        const categoryId=visualCategoryForSku(this.store,product.id),guide=categoryId?confirmedVisualGuide(this.store,categoryId):null;
        if(!guide)throw new AppError('VISUAL_GUIDE_REQUIRED','请先在设置中建立并确认当前类目的视觉指南',409);
        if(!guide.data.channels.includes(kit.channel??'taobao'))throw new AppError('GUIDE_CHANNEL_MISMATCH','类目视觉指南尚未覆盖当前渠道',409);
        for(const page of kit.pages.filter(p=>body.pageIds.includes(p.id))){
          if(page.copyStatus!=='confirmed')throw new AppError('COPY_NOT_CONFIRMED','请先确认本页文案',409);
          const asset=this.store.db.prepare('SELECT product_id,sha256 FROM assets WHERE id=?').get(page.assetId!);
          if(!asset||asset.product_id!==product.id)throw new AppError('IMAGE_OWNERSHIP','参考图必须属于当前商品',409);
          if(guideTextViolations(guide.data,page).some(rule=>rule.severity==='BLOCK'))throw new AppError('VISUAL_GUIDE_CONFLICT','确认文案包含类目禁忌表达，请先修改文案',409);
          const facts=factsForPage(this.store,product,page);
          const imageTypeGuide=confirmedImageType(this.store,page.templateId??'');
          if(!imageTypeGuide)throw new AppError('IMAGE_TYPE_GUIDE_REQUIRED','请先在视觉指南中确认当前槽位的通用图型规则',409);
          try{referenceVisualInputs[page.id]=assembleReferencePrompt(guide,page,facts,page.assetId!,String(asset.sha256),{imageTypeGuide,strategy:body.editStrategy??'PRESERVE_SUBJECT',channel:kit.channel??'taobao',seed:body.seed});}catch{throw new AppError('GUIDE_PAGE_MISSING','两层指南与当前页面或渠道不匹配',409);}
        }
      }
      const issues = body.operation === 'export' ? exportIssues(this.store, kit) : [];
      if (issues.length) throw new AppError('REVIEW_REQUIRED', issues.join('\n'), 409);
      if (Number(this.store.db.prepare("SELECT count(*) AS n FROM tasks WHERE state IN ('queued','running','saving_result')").get()!.n) + (body.operation === 'export' ? 1 : body.pageIds.length) > 50) throw new AppError('QUEUE_FULL', '待处理任务已满，请稍后提交', 429);
      const id = randomUUID(), time = now(), record = body.operation === 'export' ? this.store.startExport(kit) : null;
      const assetHashes: Record<string, string> = {};
      for (const page of kit.pages) if (page.assetId) assetHashes[page.assetId] = String(this.store.db.prepare('SELECT sha256 FROM assets WHERE id=?').get(page.assetId)!.sha256);
      const copyFacts = body.operation === 'copy' ? Object.fromEntries(kit.pages.filter(p => body.pageIds.includes(p.id)).map(p => [p.id, factsForPage(this.store, product, p)])) : undefined;
      const direction = body.operation === 'copy' && body.productionBatchId
        ? this.store.db.prepare('SELECT d.title,d.objective FROM content_production_batches b JOIN content_direction_candidates d ON d.id=b.direction_id WHERE b.id=?').get(body.productionBatchId) as { title: string; objective: string } | undefined
        : undefined;
      const snapshot: Snapshot = { kit, product, assetHashes, rendererVersion: 'svg-v1',
        ...(body.operation === 'copy' && profile ? { copyProfile: profile as CopyProfile, copyFacts, ...(body.copySlot ? { copySlots: Object.fromEntries(body.pageIds.map(id => [id, body.copySlot!])) as Record<string, 'headline'|'subtitle'|'body'> } : {}), copyPrompts: Object.fromEntries(kit.pages.filter(p => body.pageIds.includes(p.id)).map(p => [p.id, copyPrompt(product, p, kit.pages.map(item => templateById(item.templateId)?.purpose ?? item.purpose), copyFacts![p.id], body.copySlot, direction)])) } : {}),
        ...(body.operation === 'image' && profile ? { imageProfile: {...profile as ImageProfile,...(Object.keys(referenceVisualInputs).length?{engine:'REFERENCE_IMAGE' as const}:{})}, ...(Object.keys(referenceVisualInputs).length?{referenceVisualInputs}:{}), imagePrompts: Object.fromEntries(kit.pages.filter(p => body.pageIds.includes(p.id)).map(p => [p.id, referenceVisualInputs[p.id]?.prompt ?? imagePrompt(product, p, body.imageMode)])) } : {}) };
      this.store.db.prepare('INSERT INTO jobs (id,kit_id,kit_version,product_id,product_version,operation,input_snapshot,profile_snapshot,created_at,production_batch_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, kit.id, kit.version, kit.productId, kit.productVersion, body.operation, JSON.stringify(snapshot), JSON.stringify(profile ?? {}), time, body.operation === 'export' ? null : body.productionBatchId ?? null);
      const pages = body.operation === 'export' ? [null] : body.pageIds;
      pages.forEach((pageId, ordinal) => this.store.db.prepare("INSERT INTO tasks (id,job_id,page_id,ordinal,state,stage,total,export_id,created_at,updated_at) VALUES (?,?,?,?,'queued','等待执行',?,?,?,?)").run(randomUUID(), id, pageId, ordinal, pageId ? 1 : kit.pages.length, record?.id ?? null, time, time));
      this.store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope, key, requestHash, id, time);
      return id;
    }); return this.info(id);
  }
  cancel(id: string) {
    this.info(id);
    return this.store.transaction(() => {
      const rows = this.store.db.prepare('SELECT id,state,export_id FROM tasks WHERE job_id=?').all(id);
      const cancelledIds: string[] = [], uncancelledIds: string[] = [];
      for (const row of rows) {
        if (row.state !== 'queued') { uncancelledIds.push(String(row.id)); continue; }
        this.store.db.prepare("UPDATE tasks SET state='cancelled',stage='已取消',version=version+1,updated_at=? WHERE id=? AND state='queued'").run(now(), String(row.id));
        if (row.export_id) this.store.finishExport(String(row.export_id), null, '用户取消了排队任务'); cancelledIds.push(String(row.id));
      } return { cancelledIds, uncancelledIds, job: this.info(id) };
    });
  }
  resume(id: string, key: string) {
    return this.store.transaction(() => {
      const scope = `resume:${id}`, previous = this.store.db.prepare('SELECT resource_id FROM operation_keys WHERE scope=? AND key=?').get(scope, key);
      if (previous) return this.info(String(previous.resource_id));
      const row = this.store.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
      if (!row) throw new AppError('NOT_FOUND', '任务不存在', 404);
      if (row.state !== 'failed' || !['resume_local', 'resume_copy_save', 'resume_image_save'].includes(String(row.recovery_action))) throw new AppError('NOT_RESUMABLE', '当前任务不能恢复执行', 409);
      this.store.db.prepare("UPDATE tasks SET state='queued',stage='等待恢复',safe_message=NULL,error_code=NULL,recovery_action=NULL,version=version+1,updated_at=? WHERE id=?").run(now(), id);
      this.store.db.prepare("UPDATE exports SET state='running',error=NULL WHERE id=?").run(String(row.export_id));
      this.store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope, key, hash(id), String(row.job_id), now());
      return this.info(String(row.job_id));
    });
  }
  claim(owner: string, time = Date.now(), duration = 60_000): Lease | null {
    return this.store.transaction(() => {
      // Export work can restart locally. Image work without a persisted provider result fails
      // explicitly so one interrupted generation cannot block every later image request.
      this.store.db.prepare("UPDATE tasks SET state='queued',stage='等待中断恢复',lease_owner=NULL,lease_until=NULL,version=version+1 WHERE state IN ('running','saving_result') AND lease_until<? AND job_id IN (SELECT id FROM jobs WHERE operation='export')").run(time);
      if (this.store.db.prepare("SELECT id FROM tasks WHERE state IN ('running','saving_result') AND lease_until>=? LIMIT 1").get(time)) return null;
      for (const expired of this.store.db.prepare("SELECT t.id,j.operation FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.operation IN ('copy','image') AND t.state IN ('running','saving_result') AND t.lease_until<?").all(time)) {
        const attempt = this.store.db.prepare('SELECT phase,response_descriptor FROM task_attempts WHERE task_id=? ORDER BY sequence DESC LIMIT 1').get(String(expired.id));
        const safe = attempt?.phase === 'preparing' || !!attempt?.response_descriptor;
        const failedImage = expired.operation === 'image' && !safe;
        this.store.db.prepare('UPDATE tasks SET state=?,stage=?,error_code=?,safe_message=?,lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?').run(
          safe ? 'queued' : failedImage ? 'failed' : 'needs_reconciliation',
          safe ? '等待保存恢复' : failedImage ? '生成进程已中断' : '外部结果待核实',
          failedImage ? 'WORKER_INTERRUPTED' : null,
          failedImage ? '图片生成进程中断，任务已结束，可以重新生成' : null,
          now(), String(expired.id),
        );
      }
      const row = this.store.db.prepare("SELECT t.* FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE t.state='queued' AND t.next_run_at<=? AND (j.operation IN ('export','image') OR NOT EXISTS(SELECT 1 FROM tasks n JOIN jobs k ON k.id=n.job_id WHERE k.operation='copy' AND n.state='needs_reconciliation')) ORDER BY t.created_at,t.ordinal,t.id LIMIT 1").get(time);
      if (!row) return null;
      const id = String(row.id), epoch = Number(row.lease_epoch) + 1, attemptId = randomUUID();
      const job = this.store.db.prepare('SELECT input_snapshot,operation FROM jobs WHERE id=?').get(String(row.job_id))!;
      const stage = job.operation === 'copy' ? '准备生成候选文案' : job.operation === 'image' ? '准备生成视觉候选' : '准备导出';
      this.store.db.prepare("UPDATE tasks SET state='running',stage=?,lease_owner=?,lease_until=?,lease_epoch=?,version=version+1,updated_at=? WHERE id=?").run(stage, owner, time + duration, epoch, now(), id);
      this.store.db.prepare("UPDATE task_attempts SET finished_at=?,safe_error='执行租约中断' WHERE task_id=? AND finished_at IS NULL").run(now(), id);
      const sequence = Number(this.store.db.prepare('SELECT count(*) AS n FROM task_attempts WHERE task_id=?').get(id)!.n) + 1;
      this.store.db.prepare('INSERT INTO task_attempts (id,task_id,sequence,lease_epoch,phase,started_at) VALUES (?,?,?,?,?,?)').run(attemptId, id, sequence, epoch, ['copy', 'image'].includes(String(job.operation)) ? 'preparing' : 'rendering', now());
      return { id, jobId: String(row.job_id), owner, epoch, attemptId, exportId: row.export_id ? String(row.export_id) : '', operation: String(job.operation), pageId: nullable(row.page_id), snapshot: JSON.parse(String(job.input_snapshot)) };
    });
  }
  owns(lease: Lease): boolean { return !!this.store.db.prepare("SELECT id FROM tasks WHERE id=? AND lease_owner=? AND lease_epoch=? AND lease_until>=? AND state IN ('running','saving_result')").get(lease.id, lease.owner, lease.epoch, Date.now()); }
  heartbeat(lease: Lease) { const r = this.store.db.prepare("UPDATE tasks SET lease_until=? WHERE id=? AND lease_owner=? AND lease_epoch=? AND lease_until>=? AND state IN ('running','saving_result')").run(Date.now() + 60_000, lease.id, lease.owner, lease.epoch, Date.now()); return r.changes === 1; }
  assertOwner(lease: Lease) { if (!this.owns(lease)) throw new AppError('LEASE_LOST', '任务已由其他执行进程接管', 409); }
  fail(lease: Lease, error: unknown) {
    this.store.transaction(() => {
      if (!this.owns(lease)) return;
      const code = error instanceof AppError ? error.code : lease.operation === 'copy' ? 'COPY_SAVE_FAILED' : lease.operation === 'image' ? 'IMAGE_SAVE_FAILED' : 'EXPORT_FAILED';
      const message = error instanceof AppError ? error.message : lease.operation === 'copy' ? '候选文案未保存完成，请查看任务状态后处理' : lease.operation === 'image' ? '视觉候选未保存完成，请查看任务状态后处理' : '导出未完成，请检查磁盘空间及素材文件后恢复';
      const savedResponse = this.store.db.prepare('SELECT id FROM task_attempts WHERE task_id=? AND response_descriptor IS NOT NULL LIMIT 1').get(lease.id);
      const phase = this.store.db.prepare('SELECT phase FROM task_attempts WHERE id=?').get(lease.attemptId)?.phase;
      const uncertain = lease.operation === 'copy' && (code === 'RESULT_UNCERTAIN' || (!savedResponse && phase === 'dispatching' && !['PROVIDER_REJECTED', 'PROVIDER_MODEL_DENIED', 'PROVIDER_BUSY', 'CONFIGURATION_CHANGED'].includes(code)));
      const recovery = lease.operation === 'export' ? 'resume_local' : savedResponse && code !== 'OUTPUT_INVALID' ? lease.operation === 'image' ? 'resume_image_save' : 'resume_copy_save' : null;
      this.store.db.prepare("UPDATE tasks SET state=?,stage='等待处理',error_code=?,safe_message=?,recovery_action=?,lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?").run(uncertain ? 'needs_reconciliation' : 'failed', code, message, recovery, now(), lease.id);
      this.store.db.prepare('UPDATE task_attempts SET phase=?,finished_at=?,safe_error=? WHERE id=?').run('failed', now(), code, lease.attemptId);
      if (lease.exportId) this.store.finishExport(lease.exportId, null, message);
    });
  }
}
