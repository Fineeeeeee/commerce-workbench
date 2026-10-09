import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { renderSvg } from '../../packages/contracts/render.js';
import { transparentSubjectData } from './media.js';
import { AppError } from './store.js';
import { Tasks, hash, type Lease } from './tasks.js';
import { artifactImageData } from './image-service.js';
import { addProjectEventForKit } from './content-service.js';

type FileRecord = { path: string; sha: string; bytes: number; mime: string; kind: 'page' | 'export'; key: string };
type FaultHook = (stage: 'page_saved' | 'file_finalized' | 'before_commit', completed: number) => Promise<void>;
async function fileHash(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
async function valid(root: string, file: FileRecord): Promise<boolean> {
  try { return (await stat(join(root, file.path))).size === file.bytes && await fileHash(join(root, file.path)) === file.sha; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
async function durableWrite(path: string, bytes: Uint8Array) { const handle = await open(path, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }

export async function executeExport(tasks: Tasks, lease: Lease, fault?: FaultHook) {
  const { store } = tasks, root = store.directory, manifest: Record<string, FileRecord> = {};
  const prior = store.db.prepare('SELECT response_descriptor FROM task_attempts WHERE task_id=? ORDER BY sequence DESC').all(lease.id).flatMap(r => r.response_descriptor ? [JSON.parse(String(r.response_descriptor)) as Record<string, FileRecord>] : []);
  const heartbeat = setInterval(() => { try { tasks.heartbeat(lease); } catch { /* Ownership is checked again before every commit. */ } }, 15_000);
  async function descriptor(file: FileRecord) {
    tasks.assertOwner(lease); manifest[file.key] = file;
    store.db.prepare('UPDATE task_attempts SET response_descriptor=? WHERE id=?').run(JSON.stringify(manifest), lease.attemptId);
  }
  function register(file: FileRecord, progress: number, final = false) {
    store.transaction(() => {
      tasks.assertOwner(lease);
      store.db.prepare('INSERT INTO artifacts (id,task_id,output_key,kind,relative_path,sha256,mime,bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,output_key) DO UPDATE SET relative_path=excluded.relative_path,sha256=excluded.sha256,bytes=excluded.bytes').run(randomUUID(), lease.id, file.key, file.kind, file.path, file.sha, file.mime, file.bytes, new Date().toISOString());
      store.db.prepare('UPDATE tasks SET progress=?,stage=?,version=version+1,updated_at=? WHERE id=?').run(progress, final ? '导出完成' : `已完成 ${progress} / ${lease.snapshot.kit.pages.length} 页`, new Date().toISOString(), lease.id);
      if (final) {
        store.finishExport(lease.exportId, file.path, null);
        addProjectEventForKit(store, lease.snapshot.kit.id, 'CONTENT_EXPORTED', `内容方案 v${lease.snapshot.kit.version} 已完成整套导出`);
        store.db.prepare("UPDATE tasks SET state='succeeded',lease_owner=NULL,lease_until=NULL,recovery_action=NULL,error_code=NULL,safe_message=NULL WHERE id=?").run(lease.id);
        store.db.prepare("UPDATE task_attempts SET phase='succeeded',finished_at=? WHERE id=?").run(new Date().toISOString(), lease.attemptId);
      }
    });
  }
  async function recover(key: string): Promise<FileRecord | null> {
    const row = store.db.prepare('SELECT * FROM artifacts WHERE task_id=? AND output_key=?').get(lease.id, key);
    const registered: FileRecord[] = row ? [{ key, path: String(row.relative_path), sha: String(row.sha256), bytes: Number(row.bytes), mime: String(row.mime), kind: row.kind as FileRecord['kind'] }] : [];
    for (const file of [...registered, ...prior.flatMap(m => m[key] ? [m[key]!] : [])]) if (await valid(root, file)) return file;
    return null;
  }
  try {
    tasks.assertOwner(lease);
    if (lease.snapshot.rendererVersion !== 'svg-v1') throw new AppError('RENDERER_CHANGED', '此任务使用的排版版本不可用，请重新提交');
    const kit = lease.snapshot.kit, product = lease.snapshot.product;
    const archive = await recover('archive');
    if (archive) { register(archive, kit.pages.length, true); return; }
    const files: FileRecord[] = []; let main = 0, detail = 0;
    for (const [i, page] of kit.pages.entries()) {
      tasks.assertOwner(lease);
      const key = `${page.kind}/${String(page.kind === 'main' ? ++main : ++detail).padStart(2, '0')}.png`;
      let file = await recover(key);
      if (!file) {
        if (!page.assetId) throw new AppError('ASSET_MISSING', '缺少商品素材');
        const source = store.asset(page.assetId);
        if (await fileHash(join(root, source.path)) !== lease.snapshot.assetHashes[page.assetId]) throw new AppError('ASSET_CHANGED', '素材文件与提交时不一致，请核查原始文件');
        const svg = renderSvg(page, product, await transparentSubjectData(store, page.assetId), page.visualArtifactId ? await artifactImageData(store, page.visualArtifactId) : null);
        const bytes = await sharp(Buffer.from(svg), { limitInputPixels: 16_000_000 }).png().toBuffer();
        const path = `task-files/${lease.id}/${randomUUID()}.png`, temporary = `${path}.part`;
        file = { path, key, sha: hash(bytes), bytes: bytes.length, mime: 'image/png', kind: 'page' };
        await mkdir(dirname(join(root, path)), { recursive: true });
        await descriptor(file);
        await durableWrite(join(root, temporary), bytes); tasks.assertOwner(lease);
        await rename(join(root, temporary), join(root, path));
        await fault?.('file_finalized', i + 1);
      }
      register(file, i + 1); files.push(file);
      await fault?.('page_saved', i + 1);
    }
    tasks.assertOwner(lease);
    store.db.prepare("UPDATE tasks SET state='saving_result',stage='正在打包' WHERE id=?").run(lease.id);
    const path = `exports/${lease.exportId}-${randomUUID()}.zip`, temporary = `${path}.part`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    const handle = await open(join(root, temporary), 'wx');
    let chunks: Uint8Array[] = [], zipError: Error | null = null, ended = false;
    const zip = new Zip((error, chunk, final) => { if (error) zipError = error; else chunks.push(chunk); if (final) ended = true; });
    async function flush() { if (zipError) throw zipError; for (const chunk of chunks) await handle.writeFile(chunk); chunks = []; tasks.assertOwner(lease); }
    try {
      for (const file of files) {
        const entry = new ZipPassThrough(file.key); zip.add(entry); await flush();
        for await (const chunk of createReadStream(join(root, file.path), { highWaterMark: 64 * 1024 })) { entry.push(chunk as Buffer); await flush(); }
        entry.push(new Uint8Array(), true); await flush();
      }
      for (const [name, bytes] of [['design.json', strToU8(JSON.stringify({ format: 'commerce-design-v1', kit, product }, null, 2))], ['README.txt', strToU8('主图 main/01–05；详情 detail/ 按顺序排列。图片为已审核模板排版。design.json 为设计参数，不是 PSD。')]] as const) {
        const entry = new ZipPassThrough(name); zip.add(entry); entry.push(bytes, true); await flush();
      }
      zip.end(); await flush(); if (!ended) throw new Error('ZIP incomplete'); await handle.sync();
    } finally { zip.terminate(); await handle.close(); }
    const final: FileRecord = { key: 'archive', path, sha: await fileHash(join(root, temporary)), bytes: (await stat(join(root, temporary))).size, mime: 'application/zip', kind: 'export' };
    await descriptor(final); tasks.assertOwner(lease); await rename(join(root, temporary), join(root, path));
    await fault?.('before_commit', files.length);
    register(final, files.length, true);
  } finally { clearInterval(heartbeat); }
}

export async function runOne(tasks: Tasks, owner: string) {
  const lease = tasks.claim(owner); if (!lease) return false;
  try { await executeExport(tasks, lease); } catch (e) { tasks.fail(lease, e); }
  return true;
}
