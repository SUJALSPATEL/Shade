import { config } from '../config/env.js';
import { runInlineJob } from '../services/inline-runner.js';
import { InlineJobDispatcher, RedisJobDispatcher, type JobDispatcher } from './dispatcher.js';

/**
 * Dispatcher selection.
 *
 * `QUEUE_DRIVER=redis` (the default) is the real path: envelopes go onto a
 * Redis list and the Python worker consumes them. `inline` fulfils jobs inside
 * this process using the shared mock engine, so the product runs end to end
 * with neither Redis nor Python installed.
 *
 * The inline driver is refused outright in production. A deployment that
 * silently processed documents in the web process would look like it worked
 * right up until it fell over, and that failure mode is worth a hard error at
 * boot instead.
 */

export function createDispatcher(): JobDispatcher {
  if (config.redis.driver === 'inline') {
    if (config.isProduction) {
      throw new Error(
        'QUEUE_DRIVER=inline is a development fallback and must not be used in production. ' +
          'Set QUEUE_DRIVER=redis and run the worker service.',
      );
    }
    return new InlineJobDispatcher(runInlineJob);
  }

  return new RedisJobDispatcher();
}

export type { JobDispatcher };
export { RedisJobDispatcher, InlineJobDispatcher };
