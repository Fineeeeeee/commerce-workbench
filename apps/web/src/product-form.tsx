import { Select } from './components/Select.js';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Product, ProductInput } from '../../../packages/contracts/domain.js';
import { Modal } from './components/Modal.js';

const empty: ProductInput = { name: '', brand: '', variant: '', specification: '', audience: '', origin: '', notes: '', claims: [] };
export function productData(p: ProductInput): ProductInput { return { name: p.name, brand: p.brand, variant: p.variant, specification: p.specification, audience: p.audience, origin: p.origin, notes: p.notes, claims: p.claims }; }
export function ProductForm({ product, busy, onSave, onClose }: { product?: Product; busy: boolean; onSave: (data: ProductInput) => void; onClose: () => void }) {
  const [data, setData] = useState<ProductInput>(product ? productData(product) : empty);
  const changed=JSON.stringify(data)!==JSON.stringify(product?productData(product):empty);
  const close=()=>{if(!busy&&(!changed||window.confirm('商品资料尚未保存，确定放弃修改？')))onClose();};
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(changed)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[changed]);
  const field = (key: keyof Omit<ProductInput, 'claims'>, value: string) => setData(d => ({ ...d, [key]: value }));
  return <Modal className="product-modal" title={product ? '编辑商品资料' : '建立商品档案'} onClose={close}>
    <form inert={busy} onSubmit={e => { e.preventDefault(); onSave(data); }}>
      <div className="form-grid">
        <label className="span-2">完整商品名称<input required maxLength={80} value={data.name} onChange={e => field('name', e.target.value)} placeholder="例如：品牌＋系列＋产品类型"/></label>
        <label>品牌<input required maxLength={40} value={data.brand} onChange={e => field('brand', e.target.value)}/></label>
        <label>规格<input required maxLength={40} value={data.specification} onChange={e => field('specification', e.target.value)} placeholder="例如：500ml"/></label>
        <label>系列 / 款式<input maxLength={60} value={data.variant} onChange={e => field('variant', e.target.value)}/></label>
        <label>适用对象 / 需求<input maxLength={100} value={data.audience} onChange={e => field('audience', e.target.value)}/></label>
        <label className="span-2">产地<input maxLength={80} value={data.origin} onChange={e => field('origin', e.target.value)}/></label>
      </div>
      <div className="section-heading"><h3>卖点与资料来源</h3><button type="button" className="text-button" disabled={data.claims.length >= 20} onClick={() => setData(d => ({ ...d, claims: [...d.claims, { id: crypto.randomUUID(), label: '', text: '', source: '', status: 'provided' }] }))}><Plus size={15}/>添加卖点</button></div>
      <p className="muted small">广告文案引用这些资料。来源待核实的卖点会阻止相关页面通过审核。</p>
      {data.claims.map((claim, i) => <div className="claim-form" key={claim.id}>
        <div className="form-grid"><label>卖点名称<input required maxLength={16} value={claim.label} onChange={e => setData(d => ({ ...d, claims: d.claims.map((c, j) => j === i ? { ...c, label: e.target.value } : c) }))}/></label>
        <label>资料状态<Select value={claim.status} onChange={e => setData(d => ({ ...d, claims: d.claims.map((c, j) => j === i ? { ...c, status: e.target.value as typeof c.status } : c) }))}><option value="provided">业务方提供</option><option value="approved">业务方已核实</option><option value="pending">待核实</option></Select></label>
        <label className="span-2">说明<textarea required maxLength={180} value={claim.text} onChange={e => setData(d => ({ ...d, claims: d.claims.map((c, j) => j === i ? { ...c, text: e.target.value } : c) }))}/></label>
        <label className="span-2">来源<input required maxLength={160} value={claim.source} onChange={e => setData(d => ({ ...d, claims: d.claims.map((c, j) => j === i ? { ...c, source: e.target.value } : c) }))} placeholder="例如：商品负责人提供的资料 / 文件名称"/></label></div>
      </div>)}
      <label>备注与待确认信息<textarea maxLength={1200} value={data.notes} onChange={e => field('notes', e.target.value)}/></label>
      <footer><span className="muted small">{changed?'有未保存的修改':'资料尚未修改'}</span><button type="button" disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy||!changed}>{busy ? '保存中…' : '保存商品资料'}</button></footer>
    </form>
  </Modal>;
}
