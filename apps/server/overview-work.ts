import type { FastifyInstance } from 'fastify';
import { deriveOverviewWork, type ContentJobSource, type ContentWorkSource, type OpportunityWorkSource, type ProjectWorkSource } from '../../packages/contracts/overview-work.js';
import type { ProductProject } from '../../packages/contracts/business.js';
import type { Store } from './store.js';
import { marketResearchRow } from './market-research.js';
import { templateOverview } from './content-service.js';
import { currentMarketOpportunityPromptVersion } from '../../packages/contracts/market-ai.js';
import { validatedMonitoringComparison } from './market-monitoring.js';

type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value ?? 0);
const string = (value: unknown) => String(value ?? '');

export function currentOverviewWork(store: Store) {
    const research = store.db.prepare('SELECT * FROM market_research_jobs WHERE state NOT IN (\'COMPLETED\') ORDER BY created_at DESC LIMIT 100').all().map(marketResearchRow);
    const opportunities: OpportunityWorkSource[] = store.db.prepare("SELECT o.id,o.title,o.status,json_extract(o.analysis_data,'$.batch.id') batch_id,b.name batch_name,json_extract(o.analysis_data,'$.modelMetadata.promptVersion') prompt_version FROM product_opportunities o LEFT JOIN market_batches b ON b.id=json_extract(o.analysis_data,'$.batch.id') WHERE o.status='DRAFT' ORDER BY o.updated_at DESC LIMIT 100").all().map(row => ({ id: string(row.id), title: string(row.title), status: string(row.status), batchId: string(row.batch_id), batchName: string(row.batch_name), reviewable: row.prompt_version === currentMarketOpportunityPromptVersion }));
    const projects: ProjectWorkSource[] = store.db.prepare("SELECT * FROM product_projects WHERE status<>'CLOSED' ORDER BY updated_at DESC LIMIT 100").all().map(row => {
      const project: ProductProject = { id: string(row.id), categoryId: row.category_id ? string(row.category_id) : null, name: string(row.name), status: row.status as ProductProject['status'], projectType: row.project_type ? string(row.project_type) as ProductProject['projectType'] : null, brief: JSON.parse(string(row.brief_data)), checklist: JSON.parse(string(row.checklist_data)), createdAt: string(row.created_at), updatedAt: string(row.updated_at) };
      const progress = store.db.prepare(`SELECT
        (SELECT count(*) FROM project_evidence WHERE project_id=?) evidence,
        (SELECT count(*) FROM spus WHERE product_project_id=?) spus,
        (SELECT count(*) FROM products p LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id WHERE COALESCE(s.product_project_id,link.project_id)=?) skus,
        (SELECT count(*) FROM kits k JOIN products p ON p.id=k.product_id LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id WHERE COALESCE(s.product_project_id,link.project_id)=?) content,
        (SELECT count(*) FROM channel_deliveries WHERE project_id=?) deliveries,
        (SELECT count(*) FROM business_feedback WHERE project_id=?) feedback`).get(project.id, project.id, project.id, project.id, project.id, project.id)!;
      return { project, progress: { evidence: number(progress.evidence), spus: number(progress.spus), skus: number(progress.skus), content: number(progress.content), deliveries: number(progress.deliveries), feedback: number(progress.feedback) } };
    });
    const content: ContentWorkSource[] = store.db.prepare('SELECT k.id,k.product_id,COALESCE(s.product_project_id,link.project_id) product_project_id FROM kits k JOIN products p ON p.id=k.product_id LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id ORDER BY k.updated_at DESC LIMIT 100').all().map(row => {
      const kit = store.kit(string(row.id));
      return { kitId: kit.id, kitName: kit.name, skuId: kit.productId, skuName: store.product(kit.productId).name, projectId: row.product_project_id ? string(row.product_project_id) : null, pages: templateOverview(store, kit).pages };
    });
    const contentJobs: ContentJobSource[] = store.db.prepare("SELECT j.id,j.kit_id,j.product_id,j.operation,j.created_at,k.spu_id,COUNT(t.id) active_count,SUM(CASE WHEN t.state='queued' THEN 1 ELSE 0 END) queued_count,SUM(CASE WHEN t.state='running' THEN 1 ELSE 0 END) running_count,SUM(CASE WHEN t.state='waiting_external' THEN 1 ELSE 0 END) waiting_count,SUM(CASE WHEN t.state='saving_result' THEN 1 ELSE 0 END) saving_count FROM jobs j JOIN tasks t ON t.job_id=j.id JOIN kits k ON k.id=j.kit_id WHERE t.state IN ('queued','running','waiting_external','saving_result') GROUP BY j.id ORDER BY j.created_at DESC LIMIT 100").all().map((row: Row) => {
      const kit = store.kit(string(row.kit_id));
      const owner = store.db.prepare('SELECT COALESCE(s.product_project_id,link.project_id) project_id FROM products p LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id WHERE p.id=?').get(kit.productId);
      const state = number(row.running_count) ? 'running' : number(row.saving_count) ? 'saving_result' : number(row.waiting_count) ? 'waiting_external' : 'queued';
      return { id: string(row.id), kitId: kit.id, skuId: kit.productId, kitName: kit.name, skuName: store.product(kit.productId).name, projectId: owner?.project_id ? string(owner.project_id) : null, operation: string(row.operation), state, activeCount: number(row.active_count),createdAt:string(row.created_at) };
    });
    const monitoringSignals=store.db.prepare("SELECT s.id,s.fact_data,r.market_batch_id,s.monitoring_run_id FROM market_signals s JOIN market_monitoring_runs r ON r.id=s.monitoring_run_id WHERE s.review_state='OPEN' AND s.priority='HIGH' AND r.state='COMPLETED' ORDER BY s.created_at DESC LIMIT 30").all().filter(row => { const run=store.db.prepare('SELECT * FROM market_monitoring_runs WHERE id=?').get(string(row.monitoring_run_id)); return !!run && validatedMonitoringComparison(store,run).comparable===true; }).map(row=>({id:string(row.id),label:string((JSON.parse(string(row.fact_data)) as {label:string}).label),batchId:string(row.market_batch_id)}));
    const monitoringRuns=store.db.prepare("SELECT id,state,market_batch_id,created_at FROM market_monitoring_runs WHERE state IN ('CREATED','COLLECTING','NORMALIZING','IMPORTING','DETECTING','FAILED') ORDER BY created_at DESC LIMIT 10").all().map(row=>({id:string(row.id),state:string(row.state),createdAt:string(row.created_at),batchId:row.market_batch_id?string(row.market_batch_id):null}));
    return deriveOverviewWork({ research, opportunities, projects, content, contentJobs, monitoringSignals, monitoringRuns }, new Date().toISOString());
}

export function registerOverviewWork(app: FastifyInstance, store: Store) {
  app.get('/api/overview-work', async () => currentOverviewWork(store));
}
