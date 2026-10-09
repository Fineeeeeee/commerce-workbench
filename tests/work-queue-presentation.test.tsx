import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QueueItem } from '../packages/contracts/work-queue.js';
import { presentWorkQueue } from '../apps/web/src/work-queue-presentation.js';
import { WorkQueueView } from '../apps/web/src/work-queue-view.js';
import { QueueRow, QueueGroups } from '../apps/web/src/components/queue-row.js';
import { resolveStatus } from '../apps/web/src/status-catalog.js';

const item=(id:string,source:QueueItem['source']='SYSTEM_GENERATED',status='待审核',deadline:string|null=null):QueueItem=>({id,source,status,deadline,kind:'opportunity',title:id,context:'研究',reason:'核对依据',action:'审核',target:{view:'market',opportunityId:id},priority:1,rank:1,rankingReasons:[]});
test('display grouping is stable and does not change source order, ranking or targets',()=>{
  const input=[item('other1'),item('manager1','MANAGER_ASSIGNED'),item('failed1','SYSTEM_GENERATED','失败'),item('late1','MANAGER_ASSIGNED','IN_PROGRESS','2026-10-01T00:00:00Z'),item('other2'),item('failed2','SYSTEM_GENERATED','FAILED'),item('late2','MANAGER_ASSIGNED','OPEN','2026-09-01T00:00:00Z'),item('manager2','MANAGER_ASSIGNED')];
  const before=JSON.stringify(input),output=presentWorkQueue(input,Date.parse('2026-10-09T00:00:00Z'));
  assert.deepEqual(output.map(x=>x.id),['failed1','failed2','late1','late2','manager1','manager2','other1','other2']);
  assert.equal(JSON.stringify(input),before);assert.equal(output[0],input[2]);
});
test('overview queue has exactly one primary, including no-urgent and empty states; rows have none',()=>{
  for(const attention of [[],[item('ordinary')],[item('manager','MANAGER_ASSIGNED')],[item('failed','SYSTEM_GENERATED','失败')]]){
    const html=renderToStaticMarkup(<WorkQueueView queue={{attention,running:[],updatedAt:''}} onWork={()=>{}} onRefresh={async()=>{}} recentEvents={[]}/>);
    assert.equal((html.match(/ui-button--primary/g)??[]).length,1);
    if(!attention.some(x=>x.source==='MANAGER_ASSIGNED'||x.status==='失败'))assert.match(html,/没有紧急事项/);
  }
  assert.doesNotMatch(renderToStaticMarkup(<QueueRow item={item('row')} onOpen={()=>{}}/>),/ui-button--primary|class="primary"/);
  const first=item('first'),second=item('second'),other=item('other');first.target.batchId=second.target.batchId='batch';other.target.batchId='other-batch';
  const grouped=renderToStaticMarkup(<QueueGroups items={[first,other,second]} onOpen={()=>{}}/>);
  assert.match(grouped,/2 个市场机会待审核/);assert.equal((grouped.match(/<details/g)??[]).length,1);assert.doesNotMatch(grouped,/<details[^>]* open/);assert.ok(grouped.indexOf('first')<grouped.indexOf('second'));assert.doesNotMatch(grouped,/ui-status|queue-summary-action/);
});
test('project and projected queue status mappings preserve action/error emphasis',()=>{
  assert.equal(resolveStatus('queue','失败','test').tone,'error');
  assert.equal(resolveStatus('queue','待审核','test').tone,'action');
  assert.equal(resolveStatus('queue','已上市','test').tone,'confirmed');
  assert.equal(resolveStatus('project','EVALUATING','test').tone,'neutral');
});
