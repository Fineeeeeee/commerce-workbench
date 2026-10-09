import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, Store } from './store.js';
import { Tasks, hash, type Lease, type Snapshot } from './tasks.js';
import { requestCopy, type CopyResponse } from './copy-provider.js';
import { copySchema, copyFacts, validateCopy, copyLayoutIssues, parseCopyJson, parseTemplateCopy, type CopyCandidate } from '../../packages/contracts/copy.js';
import { addProjectEventForKit } from './content-service.js';

export async function executeCopy(tasks: Tasks, lease: Lease, request: typeof requestCopy = requestCopy) {
  const db = tasks.store.db, page = lease.snapshot.kit.pages.find(p => p.id === lease.pageId);
  if (!page || !lease.snapshot.copyProfile || !lease.snapshot.copyPrompts?.[page.id]) throw new AppError('COPY_INPUT_MISSING', '文案任务输入不完整');
  const messages = lease.snapshot.copyPrompts[page.id]!;
  const heartbeat = setInterval(() => { try { tasks.heartbeat(lease); } catch { /* Commit checks still enforce ownership. */ } }, 15000);
  try {
    tasks.assertOwner(lease);
    const saved = db.prepare('SELECT response_descriptor FROM task_attempts WHERE task_id=? AND response_descriptor IS NOT NULL ORDER BY sequence DESC LIMIT 1').get(lease.id);
    let response: CopyResponse;
    if (saved) response = JSON.parse(String(saved.response_descriptor));
    else {
      tasks.store.transaction(() => {
        tasks.assertOwner(lease);
        db.prepare("UPDATE task_attempts SET phase='dispatching' WHERE id=?").run(lease.attemptId);
        db.prepare("UPDATE tasks SET stage='正在生成候选文案' WHERE id=?").run(lease.id);
        db.prepare("INSERT INTO usage_ledger (id,task_id,attempt_id,event_key,entry_type,quantity,unit,cost_status,created_at) VALUES (?,?,?,?,'reserve',1,'request','unavailable',?)").run(randomUUID(), lease.id, lease.attemptId, `${lease.id}:request`, new Date().toISOString());
      });
      response = await request(lease.snapshot.copyProfile, messages);
      tasks.store.transaction(() => {
        tasks.assertOwner(lease);
        db.prepare("UPDATE task_attempts SET phase='response_saved',provider_request_id=?,response_descriptor=? WHERE id=?").run(response.id, JSON.stringify(response), lease.attemptId);
        db.prepare("UPDATE tasks SET state='saving_result',stage='校验候选文案' WHERE id=?").run(lease.id);
        for (const unit of ['input', 'output'] as const) db.prepare("INSERT INTO usage_ledger (id,task_id,attempt_id,event_key,entry_type,quantity,unit,cost_status,created_at) VALUES (?,?,?,?,'settle',?,?,'unavailable',?) ON CONFLICT(event_key) DO NOTHING").run(randomUUID(), lease.id, lease.attemptId, `${lease.id}:${unit}`, response.usage?.[unit] ?? null, `${unit}_tokens`, new Date().toISOString());
      });
    }
    const facts = lease.snapshot.copyFacts?.[page.id] ?? copyFacts(lease.snapshot.product, page);
    let copy;
    try { if (response.finishReason !== 'stop') throw new Error('内容被截断或未正常结束'); copy = validateCopy(parseTemplateCopy(parseCopyJson(response.content), page, facts), lease.snapshot.product, page, facts); }
    catch { throw new AppError('OUTPUT_INVALID', '候选文案未通过完整性、字段长度或资料引用检查，不能采用；如需重新生成须新建任务'); }
    const data = { copy, pageId: page.id, pagePurpose: page.purpose, facts, requestedSlot: lease.snapshot.copySlots?.[page.id], layoutIssues: copyLayoutIssues(copy, page), responseModel: response.model, raw: parseCopyJson(response.content) };
    tasks.store.transaction(() => {
      tasks.assertOwner(lease);
      db.prepare("INSERT INTO artifacts (id,task_id,output_key,kind,validated_data,created_at) VALUES (?,?,'copy','copy',?,?) ON CONFLICT(task_id,output_key) DO NOTHING").run(randomUUID(), lease.id, JSON.stringify(data), new Date().toISOString());
      db.prepare("UPDATE tasks SET state='succeeded',stage='候选已生成，等待人工确认',progress=1,lease_owner=NULL,lease_until=NULL,error_code=NULL,safe_message=NULL,recovery_action=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), lease.id);
      db.prepare("UPDATE task_attempts SET phase='succeeded',finished_at=? WHERE id=?").run(new Date().toISOString(), lease.attemptId);
    });
  } finally { clearInterval(heartbeat); }
}

export function candidates(store: Store, kitId: string): CopyCandidate[] {
  store.kit(kitId);
  return store.db.prepare("SELECT a.*,j.input_snapshot,j.kit_version,j.product_version FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN jobs j ON j.id=t.job_id WHERE j.kit_id=? AND a.kind='copy' AND t.state='succeeded' ORDER BY a.created_at DESC,a.id DESC LIMIT 100").all(kitId).map(row => {
    const data = JSON.parse(String(row.validated_data));
    return { id: String(row.id), taskId: String(row.task_id), createdAt: String(row.created_at), kitVersion: Number(row.kit_version), productVersion: Number(row.product_version), pageId: data.pageId, pagePurpose: data.pagePurpose, data: data.copy, facts: data.facts, layoutIssues: data.layoutIssues, requestedSlot: data.requestedSlot };
  });
}
export const adoptionSchema = z.object({ baseVersion: z.number().int().positive(), artifactId: z.string().uuid(), content: copySchema }).strict();
export function adoptCopy(store: Store, kitId: string, input: z.infer<typeof adoptionSchema>, key: string) {
  const scope = `adopt:${kitId}`, requestHash = hash(JSON.stringify(input));
  const version = store.transaction(() => {
    const previous = store.db.prepare('SELECT * FROM operation_keys WHERE scope=? AND key=?').get(scope, key);
    if (previous) { if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一采用标识不能用于不同内容', 409); return Number(previous.resource_id); }
    const row = store.db.prepare("SELECT a.validated_data,j.input_snapshot,j.kit_id,t.state FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN jobs j ON j.id=t.job_id WHERE a.id=? AND a.kind='copy'").get(input.artifactId);
    if (!row || row.kit_id !== kitId || row.state !== 'succeeded') throw new AppError('NOT_FOUND', '候选不属于当前设计稿或尚未就绪', 404);
    const snapshot = JSON.parse(String(row.input_snapshot)) as Snapshot, data = JSON.parse(String(row.validated_data)), current = store.kit(kitId), product = store.product(current.productId);
    if (current.version !== input.baseVersion) throw new AppError('VERSION_CONFLICT', '设计稿已更新，请重新读取后采用', 409);
    if (product.version !== snapshot.product.version || current.productVersion !== product.version) throw new AppError('PRODUCT_CHANGED', '商品资料已变化，请重新核对后生成候选', 409);
    const page = current.pages.find(p => p.id === data.pageId), sourcePage = snapshot.kit.pages.find(p => p.id === data.pageId);
    if (!page || !sourcePage) throw new AppError('PAGE_MISSING', '候选页面已不存在');
    if (page.purpose !== sourcePage.purpose || page.kind !== sourcePage.kind) throw new AppError('PAGE_CHANGED', '本页用途已变化，请按当前用途重新生成候选', 409);
    const facts = snapshot.copyFacts?.[sourcePage.id] ?? copyFacts(snapshot.product, sourcePage);
    let copy;
    try { copy = validateCopy(input.content, snapshot.product, sourcePage, facts); } catch { throw new AppError('INVALID_COPY', '文案字段或资料引用无效'); }
    const issues = copyLayoutIssues(copy, page); if (issues.length) throw new AppError('LAYOUT_INVALID', issues.join('；'), 409);
    const next = { name: current.name, productVersion: current.productVersion, pages: current.pages.map(p => p.id === page.id ? { ...p, headline: copy.headline, subtitle: copy.subtitle, body: copy.body, claimIds: copy.evidenceIds.filter(id => id.startsWith('claim.')).map(id => id.slice(6)), copyStatus: 'confirmed' as const, sourceFactIds: copy.evidenceIds, reviewed: false } : p) };
    const version = current.version + 1, time = new Date().toISOString();
    store.db.prepare('INSERT INTO kit_versions VALUES (?,?,?,?)').run(kitId, version, JSON.stringify(next), time);
    store.db.prepare('UPDATE kits SET version=?,updated_at=? WHERE id=?').run(version, time, kitId);
    addProjectEventForKit(store, kitId, 'CONTENT_COPY_CONFIRMED', `${page.templateId ?? page.purpose} 文案已人工确认并保存为内容版本 v${version}`);
    store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope, key, requestHash, String(version), time);
    return version;
  }); return store.kit(kitId, version);
}

export const reconciliationSchema = z.object({ conclusion: z.enum(['not_completed', 'completed_unretrievable']), evidence: z.string().trim().min(5).max(1000), reviewer: z.string().trim().min(1).max(100) }).strict();
export function reconcileCopy(store: Store, taskId: string, input: z.infer<typeof reconciliationSchema>) {
  return store.transaction(() => {
    const row = store.db.prepare("SELECT t.id,t.job_id,t.state,j.operation FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE t.id=? AND j.operation IN ('copy','image')").get(taskId);
    if (!row || row.state !== 'needs_reconciliation') throw new AppError('NOT_RECONCILABLE', '当前任务不是待核实的生成请求', 409);
    store.db.prepare("UPDATE tasks SET state='failed',stage='已人工核对',error_code='MANUALLY_RECONCILED',safe_message=?,recovery_action=NULL,updated_at=? WHERE id=?").run(`人工核对：${input.conclusion === 'not_completed' ? '未完成生成' : '已完成但无法取回结果'}。如需重新生成请新建任务。`, new Date().toISOString(), taskId);
    store.db.prepare('UPDATE task_attempts SET safe_error=?,finished_at=? WHERE id=(SELECT id FROM task_attempts WHERE task_id=? ORDER BY sequence DESC LIMIT 1)').run(JSON.stringify(input), new Date().toISOString(), taskId);
    return new Tasks(store).info(String(row.job_id));
  });
}
