"""The worker loop: reserve → dispatch → report.

One process, N consumer threads, one shared Redis client and one shared storage
adapter. The loop's contract with the rest of the system is narrow and total:

.. code-block:: text

    reserve payload ──▶ validate envelope ──▶ resolve processor ──▶ process
          │                     │                    │                 │
          │                     │                    │                 ├─ ok  ──▶ POST complete ──▶ ack
          │                     │                    │                 ├─ typed failure ──▶ POST fail
          │                     │                    │                 ├─ progress died ──▶ requeue
          │                     │                    │                 └─ bug ──▶ POST fail PROCESSOR_ERROR
          │                     │                    └─ unsupported operation ──▶ dead-letter
          │                     └─ malformed ──▶ dead-letter (+ best-effort fail)
          └─ Redis error ──▶ back off and retry (never fatal)

Two invariants hold throughout:

**A single job never kills the process.** Every failure mode above ends in a
callback, a dead-letter entry, or a retry — never in an exception escaping the
loop. A worker that dies on one bad document takes the whole queue's throughput
with it.

**Shutdown is graceful.** ``SIGINT``/``SIGTERM`` set a stop event; each thread
finishes the job it is holding — so the job gets its completion callback and its
``LREM`` — and then exits. ``BLMOVE``'s timeout bounds how long a thread can sit
in the blocking pop, which is why ``WORKER_POLL_TIMEOUT_SECONDS`` is also the
worst-case shutdown latency. A second signal is honoured immediately: the first
says "stop when you can", the second says "stop now".
"""

from __future__ import annotations

import json
import logging
import signal
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

from pydantic import ValidationError

from .callbacks import CallbackClient, CallbackError
from .config import Settings
from .models import (
    JobCompleteRequest,
    JobEnvelope,
    JobError,
    JobFailRequest,
    JobMetadata,
    JobProgressRequest,
    JobStage,
    ProcessingOutput,
)
from .processors.base import ProcessingContext, ProcessorFailure
from .processors.registry import (
    EngineRegistryError,
    UnknownOperationError,
    get_processor,
)
from .queue import JobQueueError, RedisJobQueue
from .storage import LocalStorageReader, LocalStorageWriter, StorageReader, StorageWriter

__all__ = ["KeyValueFormatter", "Worker", "configure_logging"]

logger = logging.getLogger(__name__)

#: Delay before re-reserving after a Redis error, in seconds.
QUEUE_BACKOFF_SECONDS = 2.0

#: How long a signal-driven shutdown waits for in-flight jobs before returning.
SHUTDOWN_JOIN_SECONDS = 30.0


# ── Logging ─────────────────────────────────────────────────────────────────


class KeyValueFormatter(logging.Formatter):
    """One line per record: ``<iso> level=… logger=… msg=…``.

    Structured enough to grep and to ship to a log pipeline without a JSON
    dependency, and readable enough that ``python -m shade_worker`` in a terminal
    is still pleasant. The message is JSON-quoted when it contains whitespace, so
    a human message can never be mistaken for a structured field.
    """

    def format(self, record: logging.LogRecord) -> str:
        timestamp = (
            datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        message = record.getMessage()
        if any(character.isspace() for character in message):
            message = json.dumps(message, ensure_ascii=False)
        line = (
            f"{timestamp} level={record.levelname} logger={record.name} msg={message}"
        )
        if record.exc_info:
            line = f"{line}\n{self.formatException(record.exc_info)}"
        return line


def configure_logging(level: str, *, stream: Any | None = None) -> None:
    """Install the key=value formatter on the root logger.

    Called by the entry point rather than at import time so importing the package
    never reconfigures a host application's logging.
    """
    handler = logging.StreamHandler(stream)
    handler.setFormatter(KeyValueFormatter())
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


# ── Worker ──────────────────────────────────────────────────────────────────


class Worker:
    """Owns the consumer threads and the per-job lifecycle.

    Every collaborator is injectable. The test suite drives :meth:`handle` with a
    fake queue, a fake callback client and a temporary storage root, which is what
    makes the whole failure matrix testable without Redis or a network.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        queue: RedisJobQueue | None = None,
        callbacks: CallbackClient | None = None,
        reader: StorageReader | None = None,
        writer: StorageWriter | None = None,
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        self.settings = settings
        self.queue = queue or RedisJobQueue(settings)
        self.callbacks = callbacks or CallbackClient(
            settings.api_public_url, settings.worker_shared_token
        )
        self.reader = reader or LocalStorageReader(settings.storage_root)
        self.writer = writer or LocalStorageWriter(settings.storage_root)
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))

        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._logged = logging.getLogger(f"{__name__}.{settings.worker_id}")

    # ── Lifecycle ───────────────────────────────────────────────────────────

    def run(self, *, once: bool = False) -> int:
        """Start consuming. Returns a process exit code.

        ``once=True`` reserves and handles a single job, then returns — the mode
        used by ``python -m shade_worker --once`` for a smoke test against a real
        queue.
        """
        self._log_startup()

        if once:
            handled = self.handle_one()
            self.shutdown()
            return 0 if handled else 1

        self._install_signal_handlers()

        for index in range(max(1, self.settings.concurrency)):
            thread = threading.Thread(
                target=self._consume_loop,
                name=f"shade-consumer-{index}",
                daemon=True,
            )
            thread.start()
            self._threads.append(thread)

        self._logged.info(
            "worker.started worker_id=%s concurrency=%d engine=%s queue=%s",
            self.settings.worker_id,
            self.settings.concurrency,
            self.settings.processor_engine,
            self.settings.job_queue,
        )

        try:
            # The main thread only waits; it owns the signal handlers, which can
            # only be installed on the main thread of the process.
            while not self._stop.is_set():
                self._stop.wait(0.5)
        except KeyboardInterrupt:
            self._logged.info("worker.interrupted")
            self._stop.set()

        self._join_threads()
        self.shutdown()
        self._logged.info("worker.stopped worker_id=%s", self.settings.worker_id)
        return 0

    def stop(self) -> None:
        """Ask every consumer to finish its current job and exit."""
        self._stop.set()

    def shutdown(self) -> None:
        """Close the queue client, releasing its connection pool."""
        try:
            self.queue.close()
        except Exception:  # noqa: BLE001 - shutdown must not raise
            self._logged.debug("worker.close_failed", exc_info=True)

    # ── Startup ─────────────────────────────────────────────────────────────

    def _log_startup(self) -> None:
        self._logged.info(
            "worker.starting worker_id=%s concurrency=%d storage_root=%s",
            self.settings.worker_id,
            self.settings.concurrency,
            self.settings.storage_root,
        )

    def _install_signal_handlers(self) -> None:
        """Install graceful-shutdown handlers on SIGINT and SIGTERM.

        Signal handlers can only be registered from the main thread; if this is
        called from elsewhere the failure is logged and ignored, because a worker
        without signal handling is still a working worker — it just stops on the
        process's own terms instead.
        """

        def handler(signum: int, _frame: object) -> None:
            if self._stop.is_set():
                # Second signal: the operator has waited long enough.
                self._logged.warning("worker.forced_shutdown signal=%d", signum)
                self.shutdown()
                raise SystemExit(130)
            self._logged.info("worker.shutdown_requested signal=%d", signum)
            self._stop.set()

        for signal_name in ("SIGINT", "SIGTERM"):
            number = getattr(signal, signal_name, None)
            if number is None:
                continue
            try:
                signal.signal(number, handler)
            except ValueError:  # not the main thread, or unsupported platform
                self._logged.debug("worker.signal_unavailable signal=%s", signal_name)

    def _join_threads(self) -> None:
        deadline = time.monotonic() + SHUTDOWN_JOIN_SECONDS
        for thread in self._threads:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._logged.warning("worker.join_timeout")
                break
            thread.join(timeout=remaining)
        self._threads.clear()

    # ── Consuming ───────────────────────────────────────────────────────────

    def _consume_loop(self) -> None:
        """Reserve and handle jobs until stopped.

        A Redis outage is transient by assumption: log, back off, keep trying. The
        alternative — exiting — would turn a 30-second network blip into a
        dead worker that nobody notices until the queue backs up.
        """
        while not self._stop.is_set():
            try:
                payload = self.queue.reserve()
            except JobQueueError as exc:
                self._logged.error("queue.reserve_failed error=%s", exc)
                self._stop.wait(QUEUE_BACKOFF_SECONDS)
                continue
            if payload is None:
                continue
            try:
                self.handle(payload)
            except Exception:  # noqa: BLE001 - the loop must survive anything
                # handle() reports its own failures; reaching here means the
                # reporting itself blew up. Log and keep consuming.
                self._logged.error("worker.handle_crashed", exc_info=True)

    def handle_one(self) -> bool:
        """Reserve and handle exactly one job. Returns whether one was handled."""
        try:
            payload = self.queue.reserve()
        except JobQueueError as exc:
            self._logged.error("queue.reserve_failed error=%s", exc)
            return False
        if payload is None:
            self._logged.info("worker.no_job_reserved")
            return False
        self.handle(payload)
        return True

    # ── Per-job handling ────────────────────────────────────────────────────

    def handle(self, payload: str) -> None:
        """Dispatch one raw queue payload through its full lifecycle.

        This is the method the tests drive directly. It never raises for a
        job-level problem: everything ends in an ack, a requeue, a dead-letter, or
        a callback.
        """
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            self._dead_letter(payload, f"payload is not valid JSON: {exc}")
            return

        if not isinstance(data, Mapping):
            self._dead_letter(payload, "payload is not a JSON object")
            return

        try:
            envelope = JobEnvelope.model_validate(data)
        except ValidationError as exc:
            reason = _summarise_validation_error(exc)
            self._dead_letter(
                payload,
                f"envelope failed validation: {reason}",
                # The job id may still be legible even when the rest is not, and a
                # job stuck in PROCESSING forever is worse than a wrong error code.
                fallback=data,
                code="UNSUPPORTED_FORMAT" if "operation" in reason else "INTERNAL_ERROR",
                message="The job payload did not match the worker's protocol version.",
            )
            return

        try:
            processor = get_processor(envelope.operation, self.settings)
        except UnknownOperationError as exc:
            self._dead_letter(
                payload,
                str(exc),
                fallback=data,
                code="UNSUPPORTED_FORMAT",
                message=f"The worker cannot perform a {envelope.operation} job.",
            )
            return
        except EngineRegistryError as exc:
            # A misconfiguration, not a bad job. Fail the job loudly and let the
            # operator see it; refusing to start would be the alternative, but a
            # registered engine may still be coming up.
            self._dead_letter(
                payload,
                f"engine registry error: {exc}",
                fallback=data,
                code="INTERNAL_ERROR",
                message="The worker's processor engine is not configured correctly.",
            )
            return

        self._logged.info(
            "job.received job_id=%s document_id=%s operation=%s attempt=%d filename=%s",
            envelope.job_id,
            envelope.document_id,
            envelope.operation,
            envelope.attempt,
            envelope.document.filename,
        )

        ctx = self._build_context(envelope)

        try:
            output = processor.process(ctx)
        except ProcessorFailure as exc:
            self._report_failure(payload, envelope, exc.request)
            return
        except CallbackError as exc:
            # Progress reporting died mid-job. Nothing was completed, so the job
            # is not the problem — hand it back for another attempt.
            self._logged.error(
                "job.callback_lost job_id=%s error=%s", envelope.job_id, exc
            )
            self._settle(
                payload, envelope, requeue=True, reason=f"callback failure: {exc}"
            )
            return
        except Exception as exc:  # noqa: BLE001 - a processor bug must not kill the loop
            self._logged.error(
                "job.processor_error job_id=%s", envelope.job_id, exc_info=True
            )
            self._report_failure(
                payload,
                envelope,
                JobFailRequest(
                    error=JobError(
                        code="PROCESSOR_ERROR",
                        message="The document could not be processed.",
                        retryable=True,
                        detail=f"{type(exc).__name__}: {exc}",
                    )
                ),
            )
            return

        try:
            self.callbacks.report_complete(
                envelope.job_id,
                _complete_request(output),
                base_url=envelope.callback.base_url,
            )
        except CallbackError as exc:
            # Artifacts are on disk and the work is idempotent, so a redelivery is
            # safe and is the only way the job ever reaches COMPLETED.
            self._logged.error(
                "job.complete_callback_failed job_id=%s error=%s", envelope.job_id, exc
            )
            self._settle(
                payload, envelope, requeue=True, reason=f"complete callback failed: {exc}"
            )
            return

        self.queue.ack(payload)
        self._logged.info(
            "job.completed job_id=%s operation=%s chunks=%d assets=%d duration_ms=%d",
            envelope.job_id,
            envelope.operation,
            output.metrics.chunk_count,
            output.metrics.asset_count,
            output.metadata.duration_ms,
        )

    # ── Context ─────────────────────────────────────────────────────────────

    def _build_context(self, envelope: JobEnvelope) -> ProcessingContext:
        """Wire a fresh context for one job.

        The progress callback is bound to this envelope, so a processor's
        ``ctx.stage(...)`` needs no knowledge of job ids, URLs or tokens.
        """

        def progress(stage: JobStage, percent: int, message: str | None) -> None:
            request = (
                JobProgressRequest(progress=percent, stage=stage, message=message)
                if message is not None
                else JobProgressRequest(progress=percent, stage=stage)
            )
            self.callbacks.report_progress(
                envelope.job_id, request, base_url=envelope.callback.base_url
            )
            self._logged.info(
                "job.progress job_id=%s stage=%s progress=%d",
                envelope.job_id,
                stage,
                percent,
            )

        ctx = ProcessingContext(
            envelope=envelope,
            reader=self.reader,
            writer=self.writer,
            settings=self.settings,
            progress=progress,
            now_ms=self.now_ms,
        )
        ctx.started_at_ms = self.now_ms()
        return ctx

    # ── Settlement ──────────────────────────────────────────────────────────

    def _report_failure(
        self, payload: str, envelope: JobEnvelope, request: JobFailRequest
    ) -> None:
        """Post a failure callback, then settle the payload.

        The callback goes out before the payload is settled so the API learns the
        outcome even if the settle step then fails.
        """
        try:
            self.callbacks.report_fail(
                envelope.job_id, request, base_url=envelope.callback.base_url
            )
        except CallbackError as exc:
            self._logged.error(
                "job.fail_callback_failed job_id=%s error=%s", envelope.job_id, exc
            )

        error = request.error
        self._logged.error(
            "job.failed job_id=%s code=%s retryable=%s message=%s",
            envelope.job_id,
            error.code,
            error.retryable,
            error.message,
        )
        # Retries are the API's to schedule — it owns the attempt counter and the
        # retry policy. The worker's job is to stop holding the payload, and to
        # stop it from cycling forever if the API never does.
        self._settle(payload, envelope, requeue=False, reason=f"{error.code}: {error.message}")

    def _settle(
        self,
        payload: str,
        envelope: JobEnvelope,
        *,
        requeue: bool,
        reason: str,
    ) -> None:
        """Acknowledge, requeue or dead-letter a payload after handling.

        The attempt counter decides: while the API may still redeliver, the
        payload is released (acked) or handed back (requeued); once the attempts
        are exhausted it is parked on the dead-letter list so a human can see why.
        """
        if envelope.attempt >= self.settings.max_attempts:
            self._dead_letter(
                payload,
                f"attempts exhausted ({envelope.attempt}/{self.settings.max_attempts}): {reason}",
            )
        elif requeue:
            self.queue.requeue(payload)
            self._logged.warning(
                "job.requeued job_id=%s attempt=%d reason=%s",
                envelope.job_id,
                envelope.attempt,
                reason,
            )
        else:
            self.queue.ack(payload)

    def _dead_letter(
        self,
        payload: str,
        reason: str,
        *,
        fallback: Mapping[str, Any] | None = None,
        code: str = "INTERNAL_ERROR",
        message: str | None = None,
    ) -> None:
        """Park an unusable payload and, when possible, tell the API why.

        ``fallback`` is the raw, *unvalidated* payload dict. When it happens to
        carry a job id and a callback target, a best-effort failure callback is
        sent so the job does not sit in ``PROCESSING`` until it times out. The
        callback is attempted only when both are legible — a malformed payload
        with no job id has nobody to tell.
        """
        self._logged.error("queue.dead_letter reason=%s", reason)
        if fallback is not None and message is not None:
            self._best_effort_fail(fallback, code=code, message=message, detail=reason)
        self.queue.dead_letter(payload, reason)

    def _best_effort_fail(
        self,
        data: Mapping[str, Any],
        *,
        code: str,
        message: str,
        detail: str,
    ) -> None:
        """Report a failure from an envelope we could not fully validate."""
        job_id = data.get("jobId")
        callback = data.get("callback")
        if not isinstance(job_id, str) or not isinstance(callback, Mapping):
            return
        base_url = callback.get("baseUrl")
        if not isinstance(base_url, str):
            return

        request = JobFailRequest(
            error=JobError(
                code=code,  # type: ignore[arg-type] - constrained by callers
                message=message,
                retryable=False,
                detail=detail,
            )
        )
        try:
            self.callbacks.report_fail(job_id, request, base_url=base_url)
        except CallbackError as exc:
            self._logged.warning(
                "job.best_effort_fail_undelivered job_id=%s error=%s", job_id, exc
            )


# ── Helpers ─────────────────────────────────────────────────────────────────


def _complete_request(output: ProcessingOutput) -> JobCompleteRequest:
    """Map a processor's output onto the ``JobCompleteRequest`` wire shape.

    ``ProcessorMetadata`` carries ``processedAt``; the callback's ``metadata``
    block does not (the API records its own timestamp on receipt). Rather than
    serialising the extra field and hoping the API ignores it, the narrower model
    is built explicitly.
    """
    return JobCompleteRequest(
        artifacts=output.artifacts,
        document=output.document,
        metrics=output.metrics,
        metadata=JobMetadata(
            engine=output.metadata.engine,
            version=output.metadata.version,
            duration_ms=output.metadata.duration_ms,
            mocked=output.metadata.mocked,
        ),
    )


def _summarise_validation_error(exc: ValidationError) -> str:
    """One line naming the offending fields, for a dead-letter reason and a log.

    Pydantic's default rendering is multi-line; a dead-letter reason has to be
    readable in a single Redis list entry and a single log line.
    """
    parts: list[str] = []
    for error in exc.errors()[:6]:
        location = ".".join(str(item) for item in error.get("loc", ())) or "<root>"
        parts.append(f"{location}: {error.get('msg', 'invalid')}")
    if len(exc.errors()) > 6:
        parts.append(f"…and {len(exc.errors()) - 6} more")
    return "; ".join(parts)
