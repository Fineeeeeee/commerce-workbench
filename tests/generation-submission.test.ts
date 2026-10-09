import test from 'node:test';
import assert from 'node:assert/strict';
import { generationSubmissionKey } from '../apps/web/src/generation-submission.js';

test('生成提交在通信结果未知时复用键，明确结束后允许一次新提交',()=>{
  const values=new Map<string,string>();
  const storage={getItem:(name:string)=>values.get(name)??null,setItem:(name:string,value:string)=>{values.set(name,value);},removeItem:(name:string)=>{values.delete(name);}};
  const first=generationSubmissionKey(storage,'copy');
  assert.equal(generationSubmissionKey(storage,'copy'),first);
  assert.equal(generationSubmissionKey(storage,'copy',{state:'active'}),first);
  const retry=generationSubmissionKey(storage,'copy',{state:'failed'});
  assert.notEqual(retry,first);
  assert.equal(generationSubmissionKey(storage,'copy'),retry);
  assert.notEqual(generationSubmissionKey(storage,'copy',{state:'succeeded'}),retry);
  assert.throws(()=>generationSubmissionKey(storage,'copy',{state:'needs_reconciliation'}),/核实/);
});
