import type { FastifyInstance } from 'fastify';
import {
  createProjectRequestSchema,
  listProjectsQuerySchema,
  updateProjectRequestSchema,
} from '@shade/shared/contracts';
import type { ListResponse, Project, ProjectDetailResponse } from '@shade/shared';
import { requireUser } from '../auth/plugin.js';
import { decodeCursor, encodeCursor } from '../db/client.js';
import {
  createProject,
  deleteProject,
  findProject,
  listProjects,
  projectStats,
  updateProject,
} from '../db/repositories/projects.js';
import { listDocuments } from '../db/repositories/documents.js';
import { listActivityForProject } from '../db/repositories/activities.js';
import { errors } from '../http/errors.js';
import { parseBody, parseQuery } from '../http/validate.js';

/**
 * Project routes.
 *
 * Projects are the one part of the product that is unambiguously
 * user-scoped — an anonymous session has no projects, only documents. Every
 * handler therefore starts with `requireUser`, which is also what makes
 * `projects.user_id NOT NULL` in the schema a statement of fact rather than a
 * hope.
 */

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/projects', async (request, reply) => {
    const userId = requireUser(request);
    const input = parseBody(createProjectRequestSchema, request.body);

    const project = await createProject({
      userId,
      name: input.name,
      summary: input.summary ?? null,
    });

    return reply.code(201).send(project);
  });

  app.get('/api/projects', async (request) => {
    const userId = requireUser(request);
    const query = parseQuery(listProjectsQuerySchema, request.query);
    const cursor = decodeCursor(query.cursor);

    const rows = await listProjects({ userId, limit: query.limit + 1, cursor });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    const response: ListResponse<Project> = {
      data: page,
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.updatedAt, id: last.id }) : null,
    };
    return response;
  });

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    async (request) => {
      const userId = requireUser(request);
      const project = await findProject(request.params.projectId, userId);
      if (!project) throw errors.notFound('Project');

      const [documents, activity, stats] = await Promise.all([
        listDocuments({ owner: { userId, sessionId: null }, projectId: project.id, limit: 100 }),
        listActivityForProject(project.id, 20),
        projectStats(project.id),
      ]);

      const response: ProjectDetailResponse = {
        project: { ...project, documentCount: stats.documentCount, lastActivityAt: stats.lastActivityAt },
        documents,
        activity,
        stats,
      };
      return response;
    },
  );

  app.patch<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    async (request) => {
      const userId = requireUser(request);
      const input = parseBody(updateProjectRequestSchema, request.body);

      const updated = await updateProject({
        projectId: request.params.projectId,
        userId,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      });
      if (!updated) throw errors.notFound('Project');
      return updated;
    },
  );

  /**
   * Deletes a project.
   *
   * Documents inside it are *not* deleted — `project_id` is nullable and the
   * foreign key sets it to null, so the documents return to the unfiled list
   * rather than disappearing along with their files.
   */
  app.delete<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    async (request, reply) => {
      const userId = requireUser(request);
      const deleted = await deleteProject(request.params.projectId, userId);
      if (!deleted) throw errors.notFound('Project');
      return reply.code(204).send();
    },
  );
}
