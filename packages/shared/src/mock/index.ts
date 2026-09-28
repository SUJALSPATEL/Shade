/**
 * Mocked processing engine — the fixture document, its Markdown renderer and
 * the Parse / Extract / Split runners.
 *
 * Used by the API's `inline` dev dispatcher and by the web app's optimistic
 * previews. The Python worker mirrors this behaviour for the queued path; see
 * `services/worker/shade_worker/processors/`.
 */
export * from './fixture-document.js';
export * from './markdown.js';
export * from './engine.js';
