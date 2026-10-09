import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ProjectDetail} from '../packages/contracts/business.js';
import {projectStageSummaries,ProjectStageFlow} from '../apps/web/src/components/project-stage-flow.js';

const detail:ProjectDetail={project:{id:'project',categoryId:null,name:'测试项目',status:'EVALUATING',projectType:'NEW_PRODUCT',brief:{objective:'已填写目标',positioning:'',constraints:[],notes:''},checklist:{formulaConfirmed:false,packagingConfirmed:false,contentCompleted:false},createdAt:'2026-10-05',updatedAt:'2026-10-05'},category:null,evidence:[],spus:[],independentSkus:[],independentKits:[],deliveries:[],feedback:[],events:[]};
test('stage flow never treats project objective as confirmed NEW_PRODUCT brief',()=>{
  const stages=projectStageSummaries(detail,null);
  assert.equal(stages.length,7);assert.equal(stages[1]!.done,false);assert.equal(stages[3]!.done,false);assert.equal(stages[4]!.done,false);
  const confirmed=projectStageSummaries(detail,{brief:true,listing:false});assert.equal(confirmed[1]!.done,true);assert.equal(confirmed[3]!.done,false);
});
test('seven-stage flow keeps target sections and marks the first unfinished stage',()=>{
  const html=renderToStaticMarkup(<ProjectStageFlow detail={detail} onOpen={()=>{}}/>);
  assert.match(html,/studio-stepper project-stage-workspace/);assert.match(html,/aria-current="step"/);assert.equal((html.split('</section>')[0]!.match(/<button/g)||[]).length,7);assert.match(html,/等待 SKU/);assert.match(html,/市场依据摘要/);
});
