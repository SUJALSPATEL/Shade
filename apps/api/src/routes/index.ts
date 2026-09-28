import type { FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './auth.js';
import { registerDocumentRoutes } from './documents.js';
import { registerHealthRoutes } from './health.js';
import { registerHistoryRoutes } from './history.js';
import { registerInternalRoutes } from './internal.js';
import { registerJobRoutes } from './jobs.js';
import { registerProjectRoutes } from './projects.js';
import { registerSplitRoutes } from './split.js';
import { registerUploadRoutes } from './uploads.js';
import type { AppDeps } from './deps.js';

export type { AppDeps };

/**
 * Route registration.
 *
 * One function, called once from the server setup. Keeping it explicit rather
 * than globbing a directory means the surface is readable in one place, and the
 * order of registration — which determines which hook applies where — is
 * visible rather than filesystem-dependent.
 *
 * `registerInternalRoutes` is deliberately last: it opens its own encapsulated
 * scope, and registering it after everything else keeps that scope's hooks from
 * being confusable with the ones the public routes rely on.
 */
export async function registerRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await registerHealthRoutes(app, deps);
  await registerAuthRoutes(app);
  await registerUploadRoutes(app);
  await registerDocumentRoutes(app, deps);
  await registerJobRoutes(app, deps);
  await registerProjectRoutes(app);
  await registerHistoryRoutes(app);
  await registerSplitRoutes(app);
  await registerInternalRoutes(app);
}
