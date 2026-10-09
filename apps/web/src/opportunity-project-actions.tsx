import { Select } from './components/Select.js';
import type { ProductOpportunity } from '../../../packages/contracts/market-opportunity.js';
import type { ProductProject } from '../../../packages/contracts/business.js';

export function OpportunityProjectActions({ item, projects, choice, busy, originProject, onChoice, onCreate, onAttach, onInclude, onProject }: {
  item: ProductOpportunity; projects: ProductProject[]; choice: string; busy: boolean;
  originProject?: ProductProject; onChoice: (id: string) => void; onCreate: () => void; onAttach: () => void; onInclude?: () => void; onProject: (id: string) => void;
}) {
  const included = !!originProject && item.linkedProjects.some(project => project.id === originProject.id);
  return <div className="opportunity-project-actions">
    {item.linkedProjects.length > 0 && <div className="opportunity-linked-projects"><span>关联项目</span>{item.linkedProjects.map(project => <button key={project.id} className="text-button" onClick={() => onProject(project.id)}>{project.name} · 查看项目</button>)}</div>}
    {item.status === 'READY' && <div className="opportunity-project-controls">
      {originProject && !included && <button className="primary" disabled={busy} onClick={onInclude}>纳入当前项目</button>}
      {included && <span className="badge badge-success">已纳入当前项目</span>}
      <button className={originProject ? '' : 'primary'} disabled={busy} onClick={onCreate}>创建产品项目</button>
      {projects.length > 0 && <details><summary>{originProject ? '关联其他项目' : '关联已有项目'}</summary><div className="opportunity-link"><Select aria-label="选择关联的产品项目" value={choice} onChange={event => onChoice(event.target.value)}><option value="">选择产品项目</option>{projects.filter(project => project.id !== originProject?.id).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select><button disabled={busy || !choice || choice === originProject?.id} onClick={onAttach}>关联到所选项目</button></div></details>}
    </div>}
  </div>;
}
