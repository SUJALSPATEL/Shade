# Shade — processing plane (worker)

Turns an uploaded document into Markdown, structured JSON and retrieval matches.
This is the Python half of Shade; the control plane (API, database, artifacts)
lives in [`apps/api`](../../apps/api).

---

## What this process is, and is not

The worker exists so that **document processing can be slow, memory-hungry and
crash-prone without any of that reaching the API**.

| It does | It does not |
| --- | --- |
| Pop a job envelope off Redis | Hold a database connection |
| Read the raw upload from object storage | Know the database schema |
| Run the pipeline, reporting progress | Serve HTTP to a browser |
| Write artifacts to object storage | Store document content in PostgreSQL |
| POST progress / complete / fail back to the API | Decide who owns a document |

It holds no database credentials and no knowledge of the API's routing. Every
internal endpoint it calls is **handed to it per job**, in the envelope's
`callback` block. If this process is compromised, the blast radius is its own
jobs — not the rest of the system. That is the whole reason the split exists, and
it is worth keeping: any change that has the worker reaching for a `pg` client
is a change that undoes the architectural point.

---

## Running it

```bash
# 1. Infrastructure (PostgreSQL + Redis) from the repo root
docker compose up -d

# 2. Dependencies
python -m pip install -r services/worker/requirements.txt

# 3. Migrate + seed, then start the API — the worker needs it for callbacks
npm run db:migrate && npm run db:seed
npm run dev:api

# 4. Start the worker
cd services/worker && python -m shade_worker
```

With the default configuration the worker connects to `redis://localhost:6379`,
writes artifacts under `./.data/storage` (the same directory the API reads from)
and reports to `http://localhost:4000`.

### Useful flags

```bash
python -m shade_worker --once           # reserve and handle a single job, then exit
python -m shade_worker --dry-run        # log callbacks instead of POSTing them
python -m shade_worker --check          # validate config + engine registration, then exit
python -m shade_worker --log-level DEBUG
```

`--dry-run` is the fastest way to see what a job actually produces without a
running API: it walks the full pipeline and prints every callback payload.
`--check` is what a container's startup probe should call — it fails fast on a
missing token or an unregistered engine rather than on the first real job.

### Configuration

All environment variables, all with working defaults — see the repo-root
[`.env.example`](../../.env.example) for the annotated list. The ones that
matter most:

| Variable | Default | Notes |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | The queue. The only Redis consumer in the system. |
| `SHADE_JOB_QUEUE` | `shade:jobs` | Must match the API's `JOB_QUEUE`. |
| `WORKER_SHARED_TOKEN` | `dev-worker-token-replace-me` | Must match the API's. Sent as `X-Worker-Token`. |
| `WORKER_STORAGE_ROOT` | `./.data/storage` | Must match the API's `STORAGE_LOCAL_ROOT`. |
| `PROCESSOR_ENGINE` | `mock` | `mock` is the deterministic fixture engine. |
| `WORKER_SLOW_STAGE_SECONDS` | `0.75` | Delay per stage for `__slow__` uploads. |

---

## How a job flows

```
API                        Redis                    worker                    storage
 │                           │                        │                         │
 ├─ LPUSH shade:jobs ───────►│                        │                         │
 │                           │◄── BRPOPLPUSH ─────────┤  (atomic reserve)       │
 │                           │                        │                         │
 │◄─── POST /jobs/:id/start ─┼────────────────────────┤                         │
 │     { claimed: true }     │                        │                         │
 │◄─── POST /jobs/:id/progress ───────────────────────┤  × once per stage       │
 │                           │                        ├── write artifacts ─────►│
 │◄─── POST /jobs/:id/complete ───────────────────────┤                         │
 │                           │◄── LREM (ack) ─────────┤  (only on success)      │
```

Three properties of this loop are load-bearing:

**Reservation is atomic.** The job is moved to a per-worker in-flight list
(`BRPOPLPUSH`) rather than simply popped, so a worker that dies mid-job leaves
its payload recoverable. On startup the worker calls `recover_orphans` and
requeues anything left in its own in-flight list.

**Delivery is at-least-once, so every processor must be idempotent.** A job that
completes but whose `complete` callback is lost *is* requeued and *will* run
again. This is safe because artifacts are content-addressed by key and overwrite
in place: `artifacts/<documentId>/<operation>/document.md` is the same bytes on
the second run as the first. Nothing here appends, and nothing here counts
attempts on the storage side.

**Progress is the one report whose failure is fatal.** Completion and failure can
be re-reported; a progress report has no alternate route to the UI. If it cannot
be delivered the job is requeued rather than run blind — a job whose progress the
user cannot see is a job the user will assume is hung.

---

## Inside a job

```
ACCEPTED → FETCHING → PARSING → LAYOUT → TEXT → TABLES → IMAGES
        → STRUCTURE → MARKDOWN → JSON → PERSISTING → DONE
```

Those stages are not decoration. Each names the component that would do the work
in a real engine, and each is reported to the API as it happens, which is what
the UI's progress bar renders. `PARSE` walks all twelve; `EXTRACT` and `SPLIT`
walk shorter pipelines over the same scaffolding (neither reconstructs a page
layout, so neither has `LAYOUT`/`TABLES`/`IMAGES`).

### What is mocked, exactly

The **content** — the detected regions, their text, the table and the figure —
comes from [`shade_worker/fixtures.py`](shade_worker/fixtures.py), a port of the
shared TypeScript fixture in `packages/shared/src/mock/`. The **pipeline** is
real: real queue, real storage writes, real callbacks, real progress, real
failure handling, real byte counts.

Two consequences worth understanding:

* Every result is stamped `metadata.mocked: true` and
  `metadata.engine: "mock-structural"`. A stored result is self-describing, so
  nobody can mistake fixture output for a real extraction six months from now.
* The fixture is byte-compatible with the API's inline dev dispatcher
  (`apps/api/src/services/inline-runner.ts`), including the storage keys. Both
  planes produce identical artifacts for the same document, which is what makes
  `QUEUE_DRIVER=inline` a legitimate zero-infrastructure dev mode rather than a
  second, divergent implementation.

### Demo affordances

Two markers in the **uploaded filename** drive the failure and latency paths,
purely so the UI's error and progress states can be exercised:

| Marker | Effect |
| --- | --- |
| `__fail__` (e.g. `report__fail__.pdf`) | Fails at `PARSING` with a typed `CORRUPT_DOCUMENT` error — after the bar has visibly moved, so the failure reads as a document problem rather than a pipeline bug. |
| `__slow__` (e.g. `report__slow__.pdf`) | Holds each stage for `WORKER_SLOW_STAGE_SECONDS` so progress is watchable. |

Both are matched against the filename and neither is honoured by a real engine.

---

## Replacing the mock with a real engine

The seam is [`processors/base.py`](shade_worker/processors/base.py). A processor
gets a deliberately narrow context — the envelope, a storage reader, a storage
writer, a progress callback, an injectable clock — and returns a
`ProcessingOutput`. It never touches Redis, never constructs an HTTP request, and
never learns a job id beyond what the context hands it.

```python
class MyParseProcessor(DocumentProcessor):
    @property
    def operation(self) -> Operation:
        return "PARSE"

    def process(self, ctx: ProcessingContext) -> ProcessingOutput:
        raw = ctx.read_raw()              # the uploaded bytes
        ctx.stage("PARSING")              # -> POST /progress
        structured = my_engine(raw)       # <- your engine goes here
        markdown = render_markdown(structured)
        written = ctx.writer.write_text(
            f"{ctx.artifact_prefix}/document.md", markdown, "text/markdown"
        )
        ctx.stage("DONE")
        return ProcessingOutput(artifacts=[...], document=..., metrics=..., metadata=...)
```

Register it in [`processors/registry.py`](shade_worker/processors/registry.py)
under an engine name, set `PROCESSOR_ENGINE` to that name, and nothing else in
the worker changes. `resolve_engine_identity` then reports the real engine's name
with `mocked: false` automatically.

Two things a real engine inherits for free, because they are engine-independent
by construction: `markdown.render_markdown` consumes the *structure* rather than
the raw chunks, and the runtime handles the callback, retry and dead-letter
behaviour regardless of what the processor does. What a real engine must supply
is a `StructuredDocument`; the Markdown follows.

---

## Storage contract

Object-storage keys are a **shared contract with the API** — this worker and the
API's inline dispatcher must write byte-identical keys, or the idempotent upsert
on `UNIQUE(storage_key)` stops being idempotent.

```
raw/<documentId>/<filename>                  the upload (written by the API)
artifacts/<documentId>/parse/document.md     primary output
artifacts/<documentId>/parse/document.json   ParseResult: chunks + structure
artifacts/<documentId>/extract/extract.json  ExtractResult
artifacts/<documentId>/split/split.json      SplitResult
assets/<documentId>/<name>                   figures — document-scoped, NOT per-operation
```

`assets/` is deliberately *not* nested under an operation: a figure belongs to
the document, not to the run that happened to find it. See
`ProcessingContext.asset_prefix`.

Keys arriving over the wire are treated as hostile. `LocalStorageWriter` rejects
traversal (`../`), absolute paths, drive letters, backslashes, NUL bytes,
repeated separators and empty segments, and re-checks containment after
resolution — because a key that escapes the storage root is an arbitrary file
write, and `UnsafeStorageKeyError` failing closed is the only acceptable
behaviour.

### The wire never carries document content

The completion callback reports artifact **metadata** — type, key, mime type,
byte length — and four counts. It does not carry the chunks, the Markdown or the
extracted text. Document content belongs in object storage, never in a relational
row and never on a callback; `JobMetrics` in
[`shade_worker/models.py`](shade_worker/models.py) documents this at the point
someone would be tempted to add a `chunks` field back.

---

## Serialisation: the camelCase / snake_case split

Two conventions meet in this process, and the split is deliberate on the API
side:

* **camelCase** — anything crossing HTTP: the job envelope, every callback
  payload, document and asset descriptors. Handled by `CamelModel`.
* **snake_case** — the chunk and structure trees (`chunk_id`, `bounding_box`,
  `page_number`), because the retrieval layer consumes them directly. Handled by
  `SnakeModel`.

`to_wire()` dumps by alias with `exclude_unset=True`. That last flag is what
preserves the difference between *"this key is explicitly null"* and *"this key
was omitted"*, which the TypeScript types depend on — an `ExtractedValue` for a
field the document does not answer always carries all four keys, while a
`DocumentChunk` omits `heading_level` unless it has one. Re-validating a dumped
model would lose that distinction, which is why every model is built with
explicit keyword arguments.

---

## Failure handling

| Situation | Response |
| --- | --- |
| Payload is not JSON | Dead-letter. There is no job id, so there is nobody to tell. |
| Envelope fails validation but has a legible job id | `fail` callback with `INTERNAL_ERROR`, then dead-letter. |
| Unknown operation, or no processor registered for it | `fail` callback with `UNSUPPORTED_FORMAT`, then dead-letter. |
| Typed `ProcessorFailure` (corrupt file, no text layer, …) | `fail` callback with the typed code; retry only if `retryable`. |
| Any other exception | Caught, reported as `PROCESSOR_ERROR` (`retryable: true`), never unhandled. |
| Progress callback undeliverable | Requeue — the job is not run blind. |
| Complete/fail callback undeliverable | Requeue; artifacts are already written and the work is idempotent. |
| Attempts exhausted (`WORKER_MAX_ATTEMPTS`) | Stop holding the payload; copy it to `<queue>:failed`. |

One bad job never stops the loop. The runtime's contract is that
`handle_one()` always settles the payload — ack, requeue or dead-letter — and
that is asserted directly in the test suite.

---

## Tests

```bash
cd services/worker && python -m pytest          # or: npm run worker:test
```

The suite is hermetic: **no Redis, no network, no API**. Everything the runtime
talks to is either a pure function or a protocol the tests implement in a few
lines (an in-memory queue, a recording HTTP opener, a temp storage root). That is
a direct consequence of the processor contract — if a test needed a Redis server
to exercise a processor, the seam would be in the wrong place.

| File | Covers |
| --- | --- |
| `tests/test_parse.py` | Fixture fidelity, the Markdown renderer, the Parse pipeline, the runtime's full failure matrix, storage traversal guards, callback retry/backoff. |
| `tests/test_operations.py` | Extract and Split: their stage sequences and artifacts, the null-not-a-guess empty state, confidence arithmetic, and the retriever's score floor. |

Several assertions are deliberately *literal* rather than derived — chunk
geometry, the SVG's byte length, metrics counts. They are values a browser
positions an overlay with or a badge displays, so a change to one should fail a
test rather than silently change what the user sees.
