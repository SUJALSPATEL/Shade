/**
 * @shade/shared — the contract spine of the platform.
 *
 * Everything that more than one layer needs to agree on lives here:
 *
 *   constants.ts      domain vocabulary (operations, statuses, stages)
 *   types.ts          persisted entities and processor output shapes
 *   job-protocol.ts   the API ⇄ Python worker wire format
 *   storage-keys.ts   object-storage key layout and filename sanitisation
 *   errors.ts         the API error taxonomy and its user-facing copy
 *   ids.ts            prefixed opaque identifiers
 *   contracts/        zod request schemas (separate entry, keeps zod out of
 *                     browser bundles that only need types)
 *   mock/             the fixture document and the mocked processing engine
 *
 * The Python worker mirrors `constants.ts`, `types.ts` and `job-protocol.ts`
 * by hand in `services/worker/shade_worker/models.py`. If you change a wire
 * shape here, change it there in the same commit.
 */
export * from './constants.js';
export * from './types.js';
export * from './job-protocol.js';
export * from './storage-keys.js';
export * from './errors.js';
export * from './ids.js';
export * from './format.js';

/**
 * Response envelopes are re-exported here, but `requests.ts` is not.
 *
 * `responses.ts` imports nothing at runtime — it is pure types — so pulling it
 * into the main entry costs a browser bundle nothing. The zod request schemas
 * do have a runtime cost, which is why they stay behind `@shade/shared/contracts`.
 */
export * from './contracts/responses.js';
