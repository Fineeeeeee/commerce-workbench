import { ArrowDownToLine, FileImage, Layers3, RotateCcw } from 'lucide-react';
import type { ExportRecord, Kit, Revision } from '../../../packages/contracts/domain.js';
import { JobPanel } from './jobs.js';
import { contentRevisionLabel } from './display-text.js';

const date = (value: string) => new Date(value).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

interface VersionExportPanelProps {
  busy: boolean;
  current: Kit;
  revisions: Revision[];
  records: ExportRecord[];
  jobRefresh: number;
  onRestore: (revision: Revision) => void;
  onJobsSettled: () => void;
}

export function VersionExportPanel({ busy, current, revisions, records, jobRefresh, onRestore, onJobsSettled }: VersionExportPanelProps) {
  return <section className="standard-page history-page studio-history">
    <div className="history-grid">
      <div className="card"><h2>内容方案修订记录</h2><p className="muted small">编号只属于“{current.name}”。每次保存修改、采用候选或恢复旧稿新增一条记录；不是交付次数，也不代表审核通过。</p>
        {revisions.length ? revisions.map(revision => <div className="history-row" key={revision.version}>
          <span className="version-icon"><Layers3 size={17}/></span>
          <div><strong>{current.name} · {contentRevisionLabel(revision.version)}{current.version === revision.version && ' · 当前'}</strong><small>{date(revision.createdAt)}</small></div>
          <button disabled={busy || current.version === revision.version} onClick={() => onRestore(revision)}><RotateCcw size={14}/>恢复</button>
        </div>) : <p className="muted">保存设计稿后，版本会出现在这里。</p>}
      </div>
      <div className="card"><h2>导出记录</h2>
        {records.filter(record=>record.kitId===current.id).length ? records.filter(record=>record.kitId===current.id).map(record => <div className="history-row" key={record.id}>
          <FileImage size={20}/><div><strong>{current.name} · {contentRevisionLabel(record.kitVersion)}</strong><small>{date(record.createdAt)} · {{ running: '导出中', succeeded: '已完成', failed: '未完成' }[record.state]}</small>{record.error && <small>{record.error}</small>}</div>
          {record.state === 'succeeded' && <a className="button" href={`/api/exports/${record.id}/download`} download><ArrowDownToLine size={14}/>下载</a>}
        </div>) : <div className="mini-empty"><ArrowDownToLine/><p>完成审核后，整套导出 PNG</p><small>当前没有导出记录</small></div>}
      </div>
    </div>
    <JobPanel refresh={jobRefresh} onSettled={onJobsSettled}/>
  </section>;
}
