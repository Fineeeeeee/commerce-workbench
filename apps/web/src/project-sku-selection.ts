import type { ProjectDetail } from '../../../packages/contracts/business.js';

type ProjectSpu = ProjectDetail['spus'][number];

export function resolveProjectSkuSpu(spus: ProjectSpu[], selectedSpuId: string | null): ProjectSpu | null {
  if (spus.length === 0) return null;
  if (spus.length === 1) return spus[0] ?? null;
  return spus.find(spu => spu.id === selectedSpuId) ?? null;
}

export function projectSkuRows(detail: ProjectDetail) {
  return detail.spus.flatMap(spu => spu.skus.map(sku => ({ ...sku, spu })));
}
