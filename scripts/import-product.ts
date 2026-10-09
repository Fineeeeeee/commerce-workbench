import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { Store } from '../apps/server/store.js';
import { uploadAsset } from '../apps/server/media.js';
import { createPages, productInputSchema, kitInputSchema } from '../packages/contracts/domain.js';

const [manifestPath, ...imagePaths] = process.argv.slice(2);
if (!manifestPath || !imagePaths.length) throw new Error('用法：npm run import:product -- <本地商品资料 JSON> <图片路径...>；请先停止服务，避免并行导入');
const data = productInputSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const buffers = await Promise.all(imagePaths.map(path => readFile(path)));
const store = new Store(resolve('.runtime'));
try {
  if (store.listProducts().some(p => p.name === data.name && p.specification === data.specification)) throw new Error('同名同规格商品已存在，请在应用内维护，未重复导入');
  const product = store.createProduct(data);
  for (const [i, buffer] of buffers.entries()) await uploadAsset(store, product.id, buffer, basename(imagePaths[i]!), '用户在当前任务提供，用于本地试点');
  const assets = store.listAssets(product.id);
  const kit = store.createKit(product.id, kitInputSchema.parse({ name: `${data.variant || data.name} · 首套商品图`, productVersion: product.version, pages: createPages(product, 12, assets[0]?.id ?? null) }));
  console.log(`已导入 1 款商品、${assets.length} 张真实素材和 ${kit.pages.length} 页待编辑结构；未生成 AI 内容。`);
} finally { store.close(); }
