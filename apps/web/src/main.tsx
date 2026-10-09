import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './styles.css';
import './feedback.css';
import './workspace.css';
import './business.css';
import './business-hierarchy.css';
import './content-workbench.css';
import './visual-coherence.css';
import './work-queue.css';
import './components/interaction-system.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="fatal"><h1>页面暂时无法显示</h1><p>已保存的数据仍在本机，请重新加载页面。</p><button onClick={() => location.reload()}>重新加载</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
import './image-type-guide-panel.css';
import './batch1.css';
