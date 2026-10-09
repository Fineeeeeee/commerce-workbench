import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { ImageCandidate } from '../../packages/contracts/image.js';
import { imagePrompt } from '../../packages/contracts/image.js';
import { addProjectEventForKit } from './content-service.js';
import { AppError, Store } from './store.js';
import { imageData, transparentSubjectData } from './media.js';
import { requestImage, type ImageResponse, type PendingImageResponse } from './image-provider.js';
import { hash, Tasks, type Lease, type Snapshot } from './tasks.js';

async function download(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'aliyuncs.com' || parsed.hostname.endsWith('.aliyuncs.com'))) throw new AppError('OUTPUT_INVALID', '图片下载地址不属于可信的百炼存储域名');
  let response: Response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' }); } catch { throw new AppError('IMAGE_DOWNLOAD_FAILED', '生成结果未能下载保存，请查看任务状态后处理'); }
  const length = Number(response.headers.get('content-length') || 0);
  if (!response.ok || (length && length > 20 * 1024 * 1024)) throw new AppError('IMAGE_DOWNLOAD_FAILED', '生成结果下载失败或文件过大');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new AppError('IMAGE_DOWNLOAD_FAILED', '生成结果为空或文件过大');
  return bytes;
}

export async function executeImage(tasks: Tasks, lease: Lease, request = requestImage, fetcher: typeof fetch = fetch) {
  const { store } = tasks, db = store.db, page = lease.snapshot.kit.pages.find(p => p.id === lease.pageId);
  if (!page || !lease.snapshot.imageProfile || !lease.snapshot.imagePrompts?.[page.id]) throw new AppError('IMAGE_INPUT_MISSING', '图片任务输入不完整');
  const heartbeat = setInterval(() => { try { tasks.heartbeat(lease); } catch { /* Ownership is checked before commits. */ } }, 15_000);
  const referenceInput=lease.snapshot.referenceVisualInputs?.[page.id],started=Date.now();
  let inferenceRunId=lease.attemptId,dispatchAttempted=false;
  const saveRun=(status:'SUCCEEDED'|'FAILED'|'UNCERTAIN',output:unknown,error:string|null)=>{
    if(!referenceInput?.imageTypeGuide||!dispatchAttempted)return;
    const payload={taskId:lease.id,jobId:lease.jobId,kitId:lease.snapshot.kit.id,pageId:page.id,referenceInput,requestMode:'reference_image',parameters:{size:page.kind==='main'?'1024*1024':'864*1152',n:1,prompt_extend:false,watermark:false,seed:referenceInput.seed}};
    db.prepare(`INSERT INTO ai_inference_runs (id,task_type,capability,subject_type,subject_id,provider,model,model_version,input_fingerprint,input_data,output_data,status,latency_ms,error_code,created_at)
      VALUES (?,'image_generation','IMAGE_GENERATION','task',?,'bailian',?,NULL,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(lease.attemptId,lease.id,lease.snapshot.imageProfile!.model,hash(JSON.stringify(payload)),JSON.stringify(payload),output===null?null:JSON.stringify(output),status,Date.now()-started,error,new Date().toISOString());
  };
  try {
    tasks.assertOwner(lease);
    const saved = db.prepare('SELECT id,response_descriptor FROM task_attempts WHERE task_id=? AND response_descriptor IS NOT NULL ORDER BY sequence DESC LIMIT 1').get(lease.id);
    const size = page.kind === 'main' ? '1024*1024' : '864*1152';
    let response: ImageResponse;
    if (saved) {
      inferenceRunId=String(saved.id);
      const descriptor = JSON.parse(String(saved.response_descriptor)) as ImageResponse | PendingImageResponse;
      response = 'pending' in descriptor
        ? await request(lease.snapshot.imageProfile, lease.snapshot.imagePrompts[page.id]!, null, size, fetcher, undefined, descriptor)
        : descriptor;
    }
    else {
      if(lease.snapshot.imageProfile.engine==='REFERENCE_IMAGE'){
        const input=lease.snapshot.referenceVisualInputs?.[page.id],asset=input?db.prepare('SELECT product_id,sha256 FROM assets WHERE id=?').get(input.referenceAssetId):null;
        if(!input||!asset||asset.product_id!==lease.snapshot.product.id||asset.sha256!==input.referenceHash)throw new AppError('IMAGE_REFERENCE_CHANGED','参考素材与任务快照不一致，未发送生成请求',409);
      }
      const source = page.assetId && lease.snapshot.imageProfile.mode === 'background' ? await transparentSubjectData(store, page.assetId) : page.assetId && (lease.snapshot.imageProfile.engine === 'REFERENCE_IMAGE'||lease.snapshot.imageProfile.model === 'qwen-image-edit-plus') ? await imageData(store, page.assetId, true) : null;
      store.transaction(() => {
        tasks.assertOwner(lease);
        db.prepare("UPDATE task_attempts SET phase='dispatching' WHERE id=?").run(lease.attemptId);
        db.prepare("UPDATE tasks SET stage='正在生成视觉候选' WHERE id=?").run(lease.id);
        db.prepare("INSERT INTO usage_ledger (id,task_id,attempt_id,event_key,entry_type,quantity,unit,cost_status,created_at) VALUES (?,?,?,?,'reserve',1,'request','unavailable',?)").run(randomUUID(), lease.id, lease.attemptId, `${lease.id}:request`, new Date().toISOString());
      });
      dispatchAttempted=true;
      response = await request({...lease.snapshot.imageProfile,...(referenceInput?.seed!==undefined?{seed:referenceInput.seed}:{})}, lease.snapshot.imagePrompts[page.id]!, source, size, fetcher, pending => {
        store.transaction(() => {
          tasks.assertOwner(lease);
          db.prepare("UPDATE task_attempts SET phase='provider_pending',provider_request_id=?,response_descriptor=? WHERE id=?").run(pending.id, JSON.stringify(pending), lease.attemptId);
          db.prepare("UPDATE tasks SET stage='供应商正在生成商品场景' WHERE id=?").run(lease.id);
        });
      });
      store.transaction(() => {
        tasks.assertOwner(lease);
        saveRun('SUCCEEDED',{providerRequestId:response.id,model:response.model,imageCount:response.imageCount},null);
        db.prepare("UPDATE task_attempts SET phase='response_saved',provider_request_id=?,response_descriptor=? WHERE id=?").run(response.id, JSON.stringify(response), lease.attemptId);
        db.prepare("UPDATE tasks SET state='saving_result',stage='正在保存视觉候选' WHERE id=?").run(lease.id);
        for (const [unit, quantity] of [['image_count', response.imageCount], ['input_tokens', response.inputTokens], ['output_tokens', response.outputTokens]] as const) {
          if (quantity != null) db.prepare("INSERT INTO usage_ledger (id,task_id,attempt_id,event_key,entry_type,quantity,unit,cost_status,created_at) VALUES (?,?,?,?,'settle',?,?,'unavailable',?) ON CONFLICT(event_key) DO NOTHING").run(randomUUID(), lease.id, lease.attemptId, `${lease.id}:${unit}`, quantity, unit, new Date().toISOString());
        }
      });
    }
    const original = await download(response.url, fetcher);
    let png: Buffer, width: number, height: number;
    try {
      const image = sharp(original, { limitInputPixels: 20_000_000, failOn: 'error' });
      const info = await image.metadata();
      if (!info.width || !info.height || (info.pages ?? 1) !== 1) throw new Error('invalid');
      png = await image.png().toBuffer(); width = info.width; height = info.height;
    } catch { throw new AppError('OUTPUT_INVALID', '生成结果不是可用的静态图片'); }
    const relative = `task-files/${lease.id}/${randomUUID()}.png`, temporary = `${relative}.part`, absolute = join(store.directory, relative);
    await mkdir(dirname(absolute), { recursive: true });
    const handle = await open(join(store.directory, temporary), 'wx');
    try { await handle.writeFile(png); await handle.sync(); } finally { await handle.close(); }
    tasks.assertOwner(lease); await rename(join(store.directory, temporary), absolute);
    const metadata = { referenceInput,sourceInferenceRunId:referenceInput?.imageTypeGuide?inferenceRunId:undefined, visualMode:lease.snapshot.imageProfile.engine==='REFERENCE_IMAGE'?'REFERENCE_IMAGE':'BACKGROUND', pageId: page.id, pagePurpose: page.purpose, mode: lease.snapshot.imageProfile.mode, model: response.model, width, height, prompt: lease.snapshot.imagePrompts[page.id] };
    store.transaction(() => {
      tasks.assertOwner(lease);
      db.prepare("INSERT INTO artifacts (id,task_id,output_key,kind,relative_path,sha256,mime,bytes,validated_data,created_at) VALUES (?,?,'image','image',?,?,?,?,?,?) ON CONFLICT(task_id,output_key) DO NOTHING").run(randomUUID(), lease.id, relative, createHash('sha256').update(png).digest('hex'), 'image/png', png.length, JSON.stringify(metadata), new Date().toISOString());
      db.prepare("UPDATE tasks SET state='succeeded',stage='视觉候选已生成，等待人工确认',progress=1,lease_owner=NULL,lease_until=NULL,error_code=NULL,safe_message=NULL,recovery_action=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), lease.id);
      db.prepare("UPDATE task_attempts SET phase='succeeded',finished_at=? WHERE id=?").run(new Date().toISOString(), lease.attemptId);
    });
  } catch(error){
    const code=error instanceof AppError?error.code:'IMAGE_GENERATION_FAILED';
    saveRun(['RESULT_UNCERTAIN','PROVIDER_TIMEOUT','PROVIDER_REQUEST_FAILED'].includes(code)?'UNCERTAIN':'FAILED',null,code);
    throw error;
  } finally { clearInterval(heartbeat); }
}

export function imageCandidates(store: Store, kitId: string): ImageCandidate[] {
  store.kit(kitId);
  return store.db.prepare("SELECT a.*,j.kit_version,j.product_version FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN jobs j ON j.id=t.job_id WHERE j.kit_id=? AND a.kind='image' AND t.state='succeeded' ORDER BY a.created_at DESC,a.id DESC LIMIT 100").all(kitId).map(row => {
    const data = JSON.parse(String(row.validated_data));
    const context=data.referenceInput?.imageTypeGuide?{imageTypeVersion:data.referenceInput.imageTypeGuide.version,categoryGuideVersion:data.referenceInput.guide.version,editStrategy:data.referenceInput.editPolicy.strategy,seed:data.referenceInput.seed,sourceInferenceRunId:data.sourceInferenceRunId}:undefined;
    return { id: String(row.id), taskId: String(row.task_id), createdAt: String(row.created_at), kitVersion: Number(row.kit_version), productVersion: Number(row.product_version), pageId: data.pageId, pagePurpose: data.pagePurpose, mode: data.mode, model: data.model, width: data.width, height: data.height, prompt: data.prompt, visualMode:data.visualMode??'BACKGROUND',generationContext:context, contentUrl: `/api/artifacts/${row.id}/content` };
  });
}

export const imageAdoptionSchema = z.object({ baseVersion: z.number().int().positive(), artifactId: z.string().uuid() }).strict();
export function adoptImage(store: Store, kitId: string, input: z.infer<typeof imageAdoptionSchema>, key: string) {
  const scope = `adopt-image:${kitId}`, requestHash = hash(JSON.stringify(input));
  const version = store.transaction(() => {
    const previous = store.db.prepare('SELECT * FROM operation_keys WHERE scope=? AND key=?').get(scope, key);
    if (previous) { if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一采用标识不能用于不同内容', 409); return Number(previous.resource_id); }
    const row = store.db.prepare("SELECT a.validated_data,j.input_snapshot,j.kit_id,t.state FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN jobs j ON j.id=t.job_id WHERE a.id=? AND a.kind='image'").get(input.artifactId);
    if (!row || row.kit_id !== kitId || row.state !== 'succeeded') throw new AppError('NOT_FOUND', '视觉候选不属于当前设计稿或尚未就绪', 404);
    const snapshot = JSON.parse(String(row.input_snapshot)) as Snapshot, data = JSON.parse(String(row.validated_data)), current = store.kit(kitId), product = store.product(current.productId);
    if (data.mode === 'draft') throw new AppError('DRAFT_NOT_ADOPTABLE', '快速场景草图不含真实商品，只能用于构图参考', 409);
    if (current.version !== input.baseVersion) throw new AppError('VERSION_CONFLICT', '设计稿已更新，请重新读取后采用', 409);
    if (product.version !== snapshot.product.version || current.productVersion !== product.version) throw new AppError('PRODUCT_CHANGED', '商品资料已变化，请重新生成视觉候选', 409);
    const page = current.pages.find(p => p.id === data.pageId), sourcePage = snapshot.kit.pages.find(p => p.id === data.pageId);
    if(data.visualMode==='REFERENCE_IMAGE'&&page&&sourcePage&&['headline','subtitle','body','assetId'].some(field=>JSON.stringify(page[field as keyof typeof page])!==JSON.stringify(sourcePage[field as keyof typeof sourcePage])))throw new AppError('PAGE_CHANGED','本页文案或素材已改变，请重新生成完整候选',409);
    if (!page || !sourcePage || page.purpose !== sourcePage.purpose || page.kind !== sourcePage.kind) throw new AppError('PAGE_CHANGED', '本页用途已变化，请重新生成视觉候选', 409);
    const next = { name: current.name, productVersion: current.productVersion, pages: current.pages.map(p => p.id === page.id ? { ...p, visualArtifactId: input.artifactId, visualMode: data.visualMode??'BACKGROUND', visualReviewChecks:[], reviewed: false } : p) };
    const version = current.version + 1, time = new Date().toISOString();
    store.db.prepare('INSERT INTO kit_versions VALUES (?,?,?,?)').run(kitId, version, JSON.stringify(next), time);
    store.db.prepare('UPDATE kits SET version=?,updated_at=? WHERE id=?').run(version, time, kitId);
    addProjectEventForKit(store, kitId, 'CONTENT_VISUAL_ADOPTED', `${page.templateId ?? page.purpose} 视觉候选已采用并保存为内容版本 v${version}`);
    store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope, key, requestHash, String(version), time);
    return version;
  });
  return store.kit(kitId, version);
}

export async function artifactImageData(store: Store, artifactId: string): Promise<string> {
  const row = store.db.prepare("SELECT relative_path,mime FROM artifacts WHERE id=? AND kind='image'").get(artifactId);
  if (!row?.relative_path || row.mime !== 'image/png') throw new AppError('NOT_FOUND', '视觉候选不存在', 404);
  return `data:image/png;base64,${(await readFile(join(store.directory, String(row.relative_path)))).toString('base64')}`;
}
