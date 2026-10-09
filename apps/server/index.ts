import { resolve } from 'node:path';
import { createApp } from './app.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { app } = await createApp(resolve('.runtime'), resolve('dist/web'));
await app.listen({ host: '127.0.0.1', port: 4380 });
const worker = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url))], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
const marketWorker = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './market-worker.ts' : './market-worker.js', import.meta.url))], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
worker.on('exit', () => { if (!closing) console.error('后台执行进程已退出，请重启服务以恢复排队任务'); });
marketWorker.on('exit', () => { if (!closing) console.error('市场研究执行进程已退出，请重启服务以恢复研究任务'); });
console.log('电商产品工作台：http://127.0.0.1:4380');
let closing = false;
async function close() { if (closing) return; closing = true; worker.kill(); marketWorker.kill(); await app.close(); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
