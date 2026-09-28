import type { FastifyInstance } from 'fastify';
import { listHistoryQuerySchema } from '@shade/shared/contracts';
import type { Activity, ActivityType, ListResponse } from '@shade/shared';
import { ACTIVITY_TYPES } from '@shade/shared';
import { requireUser } from '../auth/plugin.js';
import { decodeCursor, encodeCursor } from '../db/client.js';
import { activityCounts, listActivity } from '../db/repositories/activities.js';
import { parseQuery } from '../http/validate.js';

/**
 * History.
 *
 * One feed, newest first, over the `activities` table. The work a visitor did
 * anonymously was written with a null `user_id` and re-parented on sign-up, so
 * a new account's history starts with the parse it ran before it had an
 * account — which is the behaviour that makes the anonymous flow feel like a
 * trial rather than a dead end.
 */

export async function registerHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/history', async (request) => {
    const userId = requireUser(request);
    const query = parseQuery(listHistoryQuerySchema, request.query);
    const cursor = decodeCursor(query.cursor);

    const rows = await listActivity({
      userId,
      limit: query.limit + 1,
      cursor,
      projectId: query.projectId ?? null,
      type: normaliseActivityType(query.type),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    const response: ListResponse<Activity> = {
      data: page,
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
    return response;
  });

  /** Counts per type, for the filter chips on the history page. */
  app.get('/api/history/summary', async (request) => {
    const userId = requireUser(request);
    const counts = await activityCounts(userId);
    return {
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    };
  });
}

/**
 * An unrecognised `type` filter is ignored rather than rejected.
 *
 * The filter is a convenience on a feed that is already scoped to the caller,
 * so an unknown value is better read as "no filter" than as a 400 on a page
 * whose only job is to show history.
 */
function normaliseActivityType(value: string | undefined): ActivityType | null {
  if (!value) return null;
  return (ACTIVITY_TYPES as readonly string[]).includes(value) ? (value as ActivityType) : null;
}
