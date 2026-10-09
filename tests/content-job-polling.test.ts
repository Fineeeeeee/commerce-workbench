import test from 'node:test';
import assert from 'node:assert/strict';
import { pageGenerationJob } from '../apps/web/src/content-job-polling.js';
import type { JobInfo } from '../packages/contracts/tasks.js';

function job(id:string,state:string,pages:string[],operation='image'):JobInfo {
  return {id,state,operation,kitId:'kit',kitVersion:38,name:'方案',createdAt:'2026-09-27',usage:{inputTokens:null,outputTokens:null,imageCount:null,cost:null},tasks:pages.map(pageId=>({id:pageId,pageId,state:state==='active'?'queued':'succeeded',stage:'',progress:0,total:1,error:null,recoveryAction:null,exportId:null,updatedAt:''}))};
}

test('页面从服务端整套任务恢复进度，不依赖浏览器存储或候选刷新按钮',()=>{
  const batch=job('batch','active',['F01','F02']);
  assert.equal(pageGenerationJob([job('old','succeeded',['F01']),batch],'image','F01')?.id,'batch');
  assert.equal(pageGenerationJob([batch],'image','F02')?.id,'batch');
  assert.equal(pageGenerationJob([batch],'image','D10'),null);
  assert.equal(pageGenerationJob([batch],'copy','F01'),null);
  assert.equal(pageGenerationJob([job('done','partial',['F01'])],'image','F01')?.state,'partial');
});
