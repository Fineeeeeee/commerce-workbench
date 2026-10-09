import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceSettings } from '../apps/web/src/workspace.js';

test('调试模型入口与原服务分类共存；缺失状态不伪装成功', () => {
  const defaultPage=renderToStaticMarkup(createElement(ServiceSettings,{connections:[]}));
  assert.match(defaultPage,/按功能设置模型/);assert.match(defaultPage,/页面文案生成模型 ID/);
  const previous=globalThis.window;
  globalThis.window={location:{hash:'#/settings?ui.settingsTab=content'}} as Window & typeof globalThis;
  let disconnected:string;
  try{disconnected = renderToStaticMarkup(createElement(ServiceSettings, { connections: [{ id: 'copy', name: 'ignored', description: 'API Key 后端配置', state: 'unconfigured' }] }));}finally{globalThis.window=previous;}
  assert.match(disconnected, /内容辅助/); assert.match(disconnected, /市场信息/); assert.match(disconnected, /设计交接/);
  assert.match(disconnected, /暂不可用/); assert.match(disconnected, /状态未知/);
  assert.ok(!/API Key|后端|Photoshop 文件交接|市场热点来源/.test(disconnected));
});
