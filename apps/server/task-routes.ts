import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Tasks } from './tasks.js';
import { Store } from './store.js';
import { jobInputSchema } from '../../packages/contracts/tasks.js';
import { candidates, adoptCopy, adoptionSchema, reconcileCopy, reconciliationSchema } from './copy-service.js';
import { adoptImage, imageAdoptionSchema, imageCandidates } from './image-service.js';

export function registerTasks(app: FastifyInstance, store: Store, submitted: (requestId: string, jobId: string) => void) {
  const tasks = new Tasks(store);
  const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  const keyOf = (r: FastifyRequest) => z.string().uuid().parse(r.headers['idempotency-key']);
  app.post('/api/kits/:id/jobs', async (request, reply) => {
    const job = tasks.submit(idOf(request.params), jobInputSchema.parse(request.body), keyOf(request));
    submitted(request.id, job.id);
    return reply.code(202).send(job);
  });
  app.get('/api/jobs', async request => {
    const q = z.object({ kitId: z.string().uuid().optional(), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict().parse(request.query);
    return tasks.list(q.kitId, q.cursor, q.limit);
  });
  app.get('/api/jobs/:id', async request => tasks.info(idOf(request.params)));
  app.post('/api/jobs/:id/cancel', async request => tasks.cancel(idOf(request.params)));
  app.post('/api/tasks/:id/resume', async request => tasks.resume(idOf(request.params), keyOf(request)));
  app.get('/api/kits/:id/copy-candidates', async request => candidates(store, idOf(request.params)));
  app.post('/api/kits/:id/adoptions', async request => adoptCopy(store, idOf(request.params), adoptionSchema.parse(request.body), keyOf(request)));
  app.get('/api/kits/:id/image-candidates', async request => imageCandidates(store, idOf(request.params)));
  app.post('/api/kits/:id/image-adoptions', async request => adoptImage(store, idOf(request.params), imageAdoptionSchema.parse(request.body), keyOf(request)));
  app.post('/api/tasks/:id/reconciliation', async request => reconcileCopy(store, idOf(request.params), reconciliationSchema.parse(request.body)));
}
