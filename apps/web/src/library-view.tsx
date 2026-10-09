import { ArrowRight, ImagePlus, Package, Plus, Upload } from 'lucide-react';
import type { Asset, Product } from '../../../packages/contracts/domain.js';
import { PageHeader } from './components/PageHeader.js';
import { ProductHierarchy } from './business-ui.js';
import { cleanDisplayText, businessNotes, sourceDisplayLabel } from './display-text.js';
import { ProductHistoryPanel } from './product-history-panel.js';
import { EmptyState } from './components/states.js';

interface LibraryViewProps {
  products: Product[];
  product: Product | undefined;
  assets: Asset[];
  onSelectSku: (id: string) => void;
  onCreate: () => void;
  onEdit: () => void;
  onUpload: () => void;
  onStudio: () => void;
  onSaved: () => void;
}

export function LibraryView({ products, product, assets, onSelectSku, onCreate, onEdit, onUpload, onStudio, onSaved }: LibraryViewProps) {
  return <section className="standard-page library-page">
    <PageHeader title="产品资料库" actions={<button onClick={onCreate}><Plus size={16}/>新建独立 SKU</button>}/>
    <ProductHierarchy products={products} onSku={onSelectSku}/>
    {product ? <>
      <div className="card product-details"><div className="section-heading"><h2>{product.name}</h2><button onClick={onEdit}>编辑资料</button></div>
        <ProductHistoryPanel product={product} onSaved={onSaved}/>
        <div className="facts-grid">{[['品牌', product.brand], ['规格', product.specification], ['系列 / 款式', product.variant], ['适用对象', product.audience], ['产地', product.origin]].map(([key, value]) => <div key={key}><small>{key}</small><strong>{cleanDisplayText(value || '') || '尚未提供'}</strong></div>)}</div>
        {businessNotes(product.notes) && <details className="card"><summary>商品备注</summary><p>{businessNotes(product.notes)}</p></details>}
        <h3>卖点资料</h3>{product.claims.length>0&&<details><summary>查看卖点来源</summary><ul>{[...new Set(product.claims.map(claim=>sourceDisplayLabel(claim.source)))].map(source=><li key={source}>{source} · {product.claims.filter(claim=>sourceDisplayLabel(claim.source)===source).map(claim=>claim.label).join("、")}</li>)}</ul></details>}<div className="claims-grid">{product.claims.map(claim => <article key={claim.id}><div><strong>{cleanDisplayText(claim.label)}</strong>{claim.status !== 'provided' && <span className={`badge ${claim.status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{claim.status === 'approved' ? '已核实' : '待核实'}</span>}</div><p>{cleanDisplayText(claim.text)}</p></article>)}</div>
      </div>
      <div className="section-heading asset-heading"><h2>原始商品素材 <span className="muted">{assets.length}</span></h2><button onClick={onUpload}><Upload size={16}/>上传图片</button></div>
      {assets.length>0&&<details><summary>查看素材来源</summary>{[...new Set(assets.map(asset=>sourceDisplayLabel(asset.source)))].map(source=><p key={source}>{source} · {assets.flatMap((asset,index)=>sourceDisplayLabel(asset.source)===source?[`商品素材 ${index+1}`]:[]).join('、')}</p>)}</details>}
      <div className="asset-grid">{assets.map((asset, index) => <article className="card asset-card" key={asset.id}><img loading="lazy" decoding="async" width={asset.width} height={asset.height} src={`/api/assets/${asset.id}/content?preview=1`} alt={`商品素材 ${index + 1}`}/><div><strong>商品素材 {index + 1}</strong><span>{asset.width} × {asset.height} · {asset.mime.split('/')[1]?.toUpperCase()}</span></div></article>)}{!assets.length && <EmptyState icon={<ImagePlus/>} title="暂无商品素材" desc="上传真实商品图，用于内容制作与主体核验。" action={<button onClick={onUpload}>上传图片</button>}/>}</div>
      <div className="library-next-action"><span>商品资料与素材确认后，进入内容制作。</span><button className="primary" onClick={onStudio}>进入内容工坊<ArrowRight size={16}/></button></div>
    </> : <EmptyState icon={<Package/>} title="还没有商品" desc="建立销售规格后开始制作内容。" action={<button onClick={onCreate}>新建独立 SKU</button>}/>}
  </section>;
}
