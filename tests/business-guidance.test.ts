import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectGuidance, type ProductProject } from '../packages/contracts/business.js';

const project: ProductProject = { id:'00000000-0000-4000-8000-000000000001',categoryId:null,name:'测试项目',status:'EVALUATING',projectType:null,brief:{objective:'',positioning:'',constraints:[],notes:''},checklist:{formulaConfirmed:false,packagingConfirmed:false,contentCompleted:false},createdAt:'2026-09-18T00:00:00.000Z',updatedAt:'2026-09-18T00:00:00.000Z' };

test('项目下一步只依据已有业务对象推导，不在评估阶段虚构配方流程',()=>{
  const empty=deriveProjectGuidance(project,{evidence:0,spus:0,skus:0,content:0,deliveries:0,feedback:0});
  assert.equal(empty.action,'从产品规划选一个机会');
  assert.equal(empty.actionKind, 'evidence');
  assert.deepEqual(empty.missing,['市场证据','产品定义 / SPU','可销售 SKU','内容方案']);
  assert.equal(empty.missing.some(value=>value.includes('配方')),false);
  const ready=deriveProjectGuidance(project,{evidence:1,spus:1,skus:1,content:1,deliveries:0,feedback:0});
  assert.equal(ready.action,'核对现有材料并推进至已立项');
  assert.equal(ready.actionKind, 'advance');
});

test('已上市且交付与反馈齐全时，真实未确认清单优先于重复查看成果', () => {
  const launched: ProductProject = { ...project, status: 'LAUNCHED' };
  const guidance = deriveProjectGuidance(launched, { evidence: 1, spus: 1, skus: 1, content: 1, deliveries: 1, feedback: 1 });
  assert.equal(guidance.action, '补录项目历史确认记录');
  assert.ok(guidance.missing.every(item=>item.startsWith('历史记录待补录：')));
  assert.equal(guidance.nextStatus, null);
});

test("existing SKU project can proceed to content without inventing SPU or market-evidence requirements", () => {
  const existing: ProductProject = { ...project, projectType: "EXISTING_PRODUCT" };
  const guidance = deriveProjectGuidance(existing, { evidence: 0, spus: 0, skus: 1, content: 0, deliveries: 0, feedback: 0 });
  assert.equal(guidance.actionKind, "content");
  assert.deepEqual(guidance.missing, ["内容方案"]);
});
