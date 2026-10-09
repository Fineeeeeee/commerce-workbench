import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueRow } from '../apps/web/src/components/queue-row.js';
import { eventAppearance,eventTitle,workAppearance } from '../apps/web/src/components/work-appearance.js';
import type { QueueItem } from '../packages/contracts/work-queue.js';
import { overviewProjectStage,overviewProjectStages } from '../packages/contracts/project-overview.js';

test('首页五阶段不改变生命周期：已上市仍开放，只有关闭才结束',()=>{
  assert.equal(overviewProjectStages.length,5);
  assert.equal(overviewProjectStage('APPROVED'),'进行中');
  assert.equal(overviewProjectStage('DEVELOPING'),'进行中');
  assert.equal(overviewProjectStage('READY'),'待交付');
  assert.equal(overviewProjectStage('LAUNCHED'),'进行中');
  assert.equal(overviewProjectStage('CLOSED'),'已结束');
});

test('待办图标依赖真实类型与关联工作位置，动态文案和视觉分别呈现',()=>{
  assert.equal(workAppearance({kind:'manual',target:{view:'studio',pageId:'F01'}}).tone,'orange');
  assert.equal(workAppearance({kind:'opportunity',target:{view:'market'}}).tone,'green');
  assert.equal(eventAppearance('CONTENT_COPY_CONFIRMED').tone,'purple');
  assert.equal(eventAppearance('CONTENT_VISUAL_ADOPTED').tone,'blue');
  assert.equal(eventTitle('CONTENT_VISUAL_ADOPTED','F02 视觉候选已采用'),'F02 · 视觉更新');
});
test('待办保留完整说明和原动作；无时间不伪造时间，有截止时间仍显示逾期',()=>{
  const item:QueueItem={id:'one',kind:'opportunity',title:'旅行装待人工审核',context:'原始研究样本',reason:'审核证据',status:'待审核',action:'审核机会',target:{view:'market',opportunityId:'one'},priority:1,source:'SYSTEM_GENERATED',deadline:null,rank:1,rankingReasons:[]};
  const html=renderToStaticMarkup(<QueueRow item={item} onOpen={()=>{}}/>);
  assert.match(html,/title="旅行装"/);
  assert.match(html,/title="原始研究样本"/);
  assert.match(html,/未记录任务时间/);
  assert.match(html,/审核机会/);
  assert.doesNotMatch(html,/已逾期/);
  const overdue=renderToStaticMarkup(<QueueRow item={{...item,deadline:'2020-01-01T00:00:00Z'}} onOpen={()=>{}}/>);
  assert.match(overdue,/已逾期/);
});
