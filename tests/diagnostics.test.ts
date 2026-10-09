import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/app.js';
import { diagnosticRecord } from '../apps/server/diagnostics.js';

test('诊断只接受固定字段，不记录正文、查询串或外部错误对象', () => {
  const input = { event: 'request' as const, route: '/api/products?secret=private', requestId: 'invalid\nvalue', body: 'private-body', headers: { authorization: 'private-key' }, error: new Error('private-error'), status: 400 };
  const output = JSON.stringify(diagnosticRecord(input));
  assert.ok(!/private|secret|invalid|authorization/.test(output));
  assert.equal(JSON.parse(output).status, 400);
});

test('错误编号由服务生成，响应与日志一致且不包含请求数据', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'diagnostics-test-'));
  const { app } = await createApp(directory); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/products?trace=private-query', headers: { host: '127.0.0.1:4380', 'x-request-id': 'caller-controlled', authorization: 'private-key' }, payload: { name: 'private-product' } });
  assert.equal(response.statusCode, 400);
  const id = response.headers['x-request-id'];
  assert.match(String(id), /^[a-f0-9-]{36}$/);
  assert.equal(response.json().error.requestId, id);
  const paths = await readdir(join(directory, 'logs'));
  const raw = await readFile(join(directory, 'logs', paths[0]!), 'utf8');
  const record = JSON.parse(raw.trim());
  assert.equal(record.requestId, id); assert.equal(record.route, '/api/products'); assert.equal(record.code, 'INVALID_INPUT');
  assert.ok(!/private|caller-controlled|authorization/.test(raw));
});
