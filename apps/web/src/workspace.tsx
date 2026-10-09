import { useRoutedState } from './workspace-route.js';
import { useState } from 'react';
import { ArrowRight, Settings2 } from 'lucide-react';
import { VisualGuidePanel } from './visual-guide-panel.js';
import { ModelSettingsPanel } from './model-settings-panel.js';

export type Connection = { id: string; name: string; state: string; description: string };
const groups = [
  { id: 'content', label: '内容辅助', description: '查看内容制作中的文字和图片辅助能力。', items: [
    { id: 'copy', name: '广告文案建议', description: '根据商品卖点整理候选文案，供编辑和审核。', action: '可在内容制作中手动填写文案。' },
    { id: 'image', name: '场景图片制作', description: '为商品图片制作背景与场景。', action: '可先使用已有图片完成排版。' },
  ] },
  { id: 'market', label: '市场信息', description: '查看市场信息来源的可用情况。', items: [
    { id: 'hot', name: '市场热点来源', description: '为市场研究提供近期话题和竞品线索。', action: '市场信息获取功能暂不可用。' },
  ] },
  { id: 'design', label: '设计交接', description: '查看设计文件交接能力。', items: [
    { id: 'ps', name: 'Photoshop 文件交接', description: '将设计稿交给美工继续进行分层编辑。', action: '分层文件交接暂不可用；当前支持导出 PNG 图片。' },
  ] },
] as const;

export function ServiceSettings({ connections }: { connections: Connection[] }) {
  const [selected, setSelected] = useRoutedState<string>('settingsTab','models',['models','visual-guides','content','market','design']);
  const group = groups.find(g => g.id === selected);
  return <section className="standard-page settings-page"><h1>设置与系统</h1><p className="muted">按功能调整调试模型，查看服务连接与后台任务。</p>
    <div className="settings-layout"><nav aria-label="设置分类"><button aria-pressed={selected==='models'} className={selected==='models'?'selected':''} onClick={()=>setSelected('models')}>模型设置<ArrowRight size={14}/></button><button aria-pressed={selected==='visual-guides'} onClick={()=>setSelected('visual-guides')}>类目视觉指南<ArrowRight size={14}/></button>{groups.map(g => <button key={g.id} aria-pressed={selected === g.id} className={selected === g.id ? 'selected' : ''} onClick={() => setSelected(g.id)}>{g.label}<ArrowRight size={14}/></button>)}</nav>
      {selected==='models'?<section className="card settings-group"><ModelSettingsPanel/></section>:selected==='visual-guides'?<section className="card settings-group"><VisualGuidePanel/></section>:group&&<section className="card settings-group" aria-label={group.label}><div className="section-heading"><h2>{group.label}</h2><Settings2 size={18}/></div><p className="muted small">{group.description}</p>{group.items.map(item => {
        const capability = connections.find(c => c.id === item.id);
        const available = capability?.state === 'available';
        if (capability?.state === 'ready') return <article className="setting-row" key={item.id}><div><h3>{item.name}</h3><p>服务已准备，可在内容制作中试运行并检查候选结果。</p><small>是否适合正式制作，需要通过实际文案审核。</small></div><span className="badge badge-warning">待试运行</span></article>;
        return <article className="setting-row" key={item.id}><div><h3>{item.name}</h3><p>{item.description}</p><small>{available ? '已启用' : capability ? item.action : '状态尚未读取，请刷新后重试。'}</small></div><span className={`badge ${available ? 'badge-success' : 'badge-neutral'}`}>{available ? '可用' : capability ? '暂不可用' : '状态未知'}</span></article>;
      })}</section>}
    </div>
  </section>;
}
