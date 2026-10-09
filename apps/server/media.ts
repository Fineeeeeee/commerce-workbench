import { deliveryPageIssues } from './content-service.js';
import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type Asset, type Kit } from '../../packages/contracts/domain.js';
import { renderSvg } from '../../packages/contracts/render.js';
import { Store, AppError } from './store.js';

export async function uploadAsset(store: Store, productId: string, buffer: Buffer, name: string, source: string): Promise<Asset> {
  store.product(productId);
  if (buffer.length > 15 * 1024 * 1024 || buffer.length === 0) throw new AppError('INVALID_IMAGE', '图片不能为空且不能超过 15 MB');
  let width: number, height: number, mime: string;
  try {
    const image = sharp(buffer, { limitInputPixels: 16_000_000, failOn: 'error' });
    const info = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(info.format ?? '') || !info.width || !info.height || (info.pages ?? 1) !== 1) throw new Error('format');
    await image.stats();
    width = info.width; height = info.height; mime = `image/${info.format}`;
  } catch { throw new AppError('INVALID_IMAGE', '请选择完整的静态 JPG、PNG 或 WebP（不超过 1600 万像素）'); }
  const id = randomUUID(), relative = `assets/${id}`;
  await mkdir(join(store.directory, 'assets'), { recursive: true });
  await writeFile(join(store.directory, relative), buffer, { flag: 'wx' });
  const asset: Asset = { id, productId, name: name.slice(0, 160), mime, width, height, source, createdAt: new Date().toISOString() };
  store.addAsset(asset, relative, createHash('sha256').update(buffer).digest('hex'));
  return asset;
}

export async function imageData(store: Store, assetId: string | null, flatten = false): Promise<string | null> {
  if (!assetId) return null;
  const { asset, path } = store.asset(assetId);
  const buffer = await readFile(join(store.directory, path));
  // Fit large source images once before placing them; original source bytes remain untouched.
  let image = sharp(buffer).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true });
  if (flatten) image = image.flatten({ background: '#ffffff' });
  const resized = await image.png().toBuffer();
  if (!asset.mime.startsWith('image/')) throw new AppError('INVALID_IMAGE', '素材格式异常');
  return `data:image/png;base64,${resized.toString('base64')}`;
}

export async function transparentSubjectData(store: Store, assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  const { asset, path } = store.asset(assetId);
  if (!asset.mime.startsWith('image/')) throw new AppError('INVALID_IMAGE', '素材格式异常');
  const source = await readFile(join(store.directory, path));
  const { data, info } = await sharp(source).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height, seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const isBackground = (index: number) => {
    const offset = index * 4, r = data[offset]!, g = data[offset + 1]!, b = data[offset + 2]!;
    return r >= 248 && g >= 248 && b >= 248 && Math.max(r, g, b) - Math.min(r, g, b) <= 4;
  };
  const add = (index: number) => { if (!seen[index] && isBackground(index)) { seen[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++]!, x = index % width, y = Math.floor(index / width);
    if (x > 0) add(index - 1); if (x + 1 < width) add(index + 1); if (y > 0) add(index - width); if (y + 1 < height) add(index + width);
  }
  for (let index = 0; index < seen.length; index++) {
    if (seen[index]) data[index * 4 + 3] = 0;
  }
  // Fade the one-pixel antialiased rim next to the removed white canvas. This
  // avoids a bright rectangle around a pale bottle without erasing its white body.
  const touchesBackground = (index: number) => {
    const x = index % width, y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && seen[ny * width + nx]) return true;
    }
    return false;
  };
  for (let index = 0; index < seen.length; index++) {
    if (seen[index] || !touchesBackground(index)) continue;
    const offset = index * 4, r = data[offset]!, g = data[offset + 1]!, b = data[offset + 2]!;
    if (Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 16) data[offset + 3] = Math.min(data[offset + 3]!, 72);
  }
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(data[(y*width+x)*4+3]!>0){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  if(maxX<minX||maxY<minY) throw new AppError('INVALID_IMAGE','商品主体未能从背景中识别');
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).extract({left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function exportIssues(store: Store, kit: Kit): string[] {
  const latest = store.product(kit.productId);
  const errors = latest.version !== kit.productVersion ? ['商品资料已更新，请同步资料并重新审核'] : [];
  kit.pages.forEach((page, i) => {
    const issues = deliveryPageIssues(store, kit, page);
    if (!page.reviewed) issues.push('尚未审核');
    if (issues.length) errors.push(`${i + 1}. ${page.purpose}：${issues.join('、')}`);
  }); return errors;
}
