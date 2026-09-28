import type { JobDispatcher } from '../queue/dispatcher.js';

/**
 * What the route layer is given by the server.
 *
 * Passed explicitly rather than reached for through a module-level singleton:
 * a route that needs a dispatcher should say so in its signature, and a test
 * should be able to register the same routes against a fake.
 */
export interface AppDeps {
  dispatcher: JobDispatcher;
}
