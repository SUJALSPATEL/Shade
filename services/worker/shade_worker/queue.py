"""Redis-backed job queue with a reliable-reserve pattern.

Why ``BLMOVE`` into a per-worker processing list
------------------------------------------------
A plain ``BRPOP`` deletes the job the instant it is handed over. If the worker
then crashes — OOM kill, deploy, segfault in a native PDF library — the job is
gone and the API waits forever. Instead the worker atomically *moves* the payload
from the pending list into its own processing list:

    BLMOVE shade:jobs  shade:jobs:processing:<worker_id>  LEFT RIGHT  <timeout>

The move is atomic, so the job exists in exactly one of the two lists at all
times, and this worker's processing list is a durable record of what it took on.
On success the worker ``LREM``s the payload; on permanent failure it moves the
payload to the dead-letter list.

At-least-once semantics
-----------------------
This is a reliable queue, not an exactly-once one. Three things can cause a
redelivery:

1. The worker crashes after reserving but before ``LREM``. Startup calls
   :meth:`RedisJobQueue.recover_orphans`, which pushes this worker's leftovers
   back onto the pending list.
2. The API's own retry policy re-enqueues a job the worker reported FAILED.
3. A progress callback fails permanently, so the worker abandons a job it was
   actively processing; the payload is requeued rather than dead-lettered
   (a transient API outage is not the document's fault).

**Therefore every processor must be idempotent.** Processors here are: they
derive their entire output deterministically from the envelope, and they write
artifacts by key (overwriting the same key with the same bytes on a redelivery)
rather than appending. A processor that could not make that guarantee — one that
appended to an existing artifact, or incremented a counter — would need a
deduplication key on ``jobId`` before it could be run behind this queue.

``redis`` is imported lazily so the package (and its test suite) can be imported
on a machine with no Redis client installed.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from .config import Settings

__all__ = ["JobQueueError", "RedisJobQueue"]

logger = logging.getLogger(__name__)


class JobQueueError(RuntimeError):
    """Raised when the queue cannot be reached or a reservation fails."""


class RedisJobQueue:
    """A reliable Redis list queue.

    ``client_factory`` exists so tests can inject a fake without Redis; the
    default opens a real ``redis.Redis`` from ``settings.redis_url``.
    """

    def __init__(
        self,
        settings: Settings,
        client_factory: Callable[[str], Any] | None = None,
    ) -> None:
        self.settings = settings
        self.queue = settings.job_queue
        self.processing_queue = settings.processing_queue
        self.dead_letter_queue = settings.dead_letter_queue
        self._client_factory = client_factory
        self._client: Any | None = None

    # ── Connection ──────────────────────────────────────────────────────────

    @property
    def client(self) -> Any:
        """The lazily-created Redis client."""
        if self._client is None:
            factory = self._client_factory or self._default_factory
            self._client = factory(self.settings.redis_url)
        return self._client

    @staticmethod
    def _default_factory(url: str) -> Any:
        try:
            import redis  # imported here so the module stays importable without it
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise JobQueueError(
                "the `redis` package is required to run the worker; "
                "install it with `python -m pip install -r requirements.txt`"
            ) from exc
        # decode_responses keeps payloads as str: they are JSON documents, and
        # bytes would have to be decoded at every call site anyway.
        return redis.Redis.from_url(url, decode_responses=True)

    def ping(self) -> bool:
        """Whether Redis is reachable — used for a fast, clear startup failure."""
        try:
            return bool(self.client.ping())
        except Exception as exc:  # noqa: BLE001 - driver-specific error taxonomy
            raise JobQueueError(f"cannot reach Redis at {self.settings.redis_url}: {exc}") from exc

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    # ── Reserve / acknowledge ───────────────────────────────────────────────

    def reserve(self, timeout_seconds: int | None = None) -> str | None:
        """Atomically move the next payload into this worker's processing list.

        Returns the raw JSON payload, or ``None`` if the timeout elapsed with the
        queue empty. ``timeout_seconds`` doubles as the shutdown latency bound:
        a consumer blocked here wakes at most that long after ``stop`` is set.
        """
        timeout = self.settings.poll_timeout_seconds if timeout_seconds is None else timeout_seconds
        try:
            payload = self.client.blmove(
                self.queue, self.processing_queue, timeout, "LEFT", "RIGHT"
            )
        except Exception as exc:  # noqa: BLE001 - driver-specific error taxonomy
            raise JobQueueError(f"reserve failed: {exc}") from exc
        return payload

    def ack(self, payload: str) -> None:
        """Drop a payload from the processing list after successful completion."""
        self._remove_from_processing(payload)

    def requeue(self, payload: str) -> None:
        """Put a payload back at the head of the pending list for redelivery.

        Used when the job failed for a reason that is not the document's fault —
        a dead API, a storage blip — so the attempt is not counted against it.
        Pushed to the head so it is retried promptly rather than after the whole
        backlog.
        """
        self.client.lpush(self.queue, payload)
        self._remove_from_processing(payload)

    def dead_letter(self, payload: str, reason: str) -> None:
        """Park a payload on ``shade:jobs:failed`` with the reason attached.

        The original payload is embedded verbatim (as a string, not re-parsed) so
        an operator can replay a dead-lettered job without having to reconstruct
        it. Nothing removes entries from this list automatically — it is a manual
        operator surface, by design.
        """
        entry = json.dumps(
            {
                "reason": reason,
                "queue": self.queue,
                "payload": payload,
            }
        )
        self.client.rpush(self.dead_letter_queue, entry)
        self._remove_from_processing(payload)
        logger.error(
            "queue.dead_letter queue=%s reason=%s", self.dead_letter_queue, reason
        )

    def recover_orphans(self) -> int:
        """Return jobs stranded by a previous run of this worker id to the queue.

        Called once at startup. Anything still in the processing list belongs to a
        process that died mid-job, so it is pushed back for redelivery — which is
        precisely the "at least once" in the semantics. Returns how many were
        recovered.
        """
        recovered = 0
        while True:
            payload = self.client.rpoplpush(self.processing_queue, self.queue)
            if payload is None:
                break
            recovered += 1
        if recovered:
            logger.warning(
                "queue.recovered_orphans worker_id=%s count=%d",
                self.settings.worker_id,
                recovered,
            )
        return recovered

    def queue_depth(self) -> int:
        """Pending job count — logged on startup and useful for readiness probes."""
        return int(self.client.llen(self.queue))

    # ── Internals ───────────────────────────────────────────────────────────

    def _remove_from_processing(self, payload: str) -> None:
        # count=1: a payload is reserved once, so one removal is exact. A second
        # occurrence would mean the same bytes were enqueued twice, and removing
        # both would lose the second job.
        self.client.lrem(self.processing_queue, 1, payload)
