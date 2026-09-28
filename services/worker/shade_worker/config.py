"""Worker configuration, read from the environment.

Deliberately stdlib-only (``os.environ``) rather than pydantic-settings or
python-dotenv: the worker is deployed as a container that receives its whole
configuration as environment variables, and one fewer dependency is one fewer
thing to pin and audit. For local development, export the variables or use your
shell's ``.env`` loader — the repo-root ``.env.example`` documents them all.

Every value has a sane default so ``python -m shade_worker`` starts against a
stock local stack with no configuration at all.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

__all__ = ["Settings"]


def _get(env: Mapping[str, str], name: str, default: str) -> str:
    value = env.get(name)
    return default if value is None or value == "" else value


def _get_int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _get_float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc


def _default_worker_id() -> str:
    """A stable-per-process id used to name this worker's in-flight Redis list."""
    return f"{socket.gethostname()}-{os.getpid()}"


@dataclass(frozen=True, slots=True)
class Settings:
    """The worker's entire runtime configuration."""

    #: Redis connection string. The queue is the only Redis consumer.
    redis_url: str = "redis://localhost:6379"

    #: The pending-jobs list the API pushes onto.
    job_queue: str = "shade:jobs"

    #: Shared secret presented as ``X-Worker-Token`` on every internal callback.
    worker_shared_token: str = "dev-worker-token-replace-me"

    #: Number of consumer threads. Each thread reserves at most one job.
    concurrency: int = 2

    #: Blocking-pop timeout. Also the shutdown latency upper bound.
    poll_timeout_seconds: int = 5

    #: Which processor implementation the registry resolves. ``mock`` maps to the
    #: deterministic fixture engine; anything else must be registered first.
    processor_engine: str = "mock"

    #: Reported in ``metadata.version`` for every result.
    processor_version: str = "0.1.0"

    #: Root the local storage adapter writes under. Must match the API's
    #: ``STORAGE_LOCAL_ROOT`` for the two processes to share an object store.
    storage_root: Path = field(default_factory=lambda: Path("./.data/storage"))

    #: The API's own public URL — the fallback when an envelope omits a callback
    #: base URL.
    api_public_url: str = "http://localhost:4000"

    log_level: str = "INFO"

    #: Delivery attempts after which a job is copied to the dead-letter list.
    max_attempts: int = 3

    #: Seconds slept between stages when the filename carries ``__slow__``.
    slow_stage_seconds: float = 0.75

    #: Identifies this process in Redis list names and in log lines.
    worker_id: str = field(default_factory=_default_worker_id)

    @property
    def dead_letter_queue(self) -> str:
        """Where jobs land after ``max_attempts`` failures or a bad envelope."""
        return f"{self.job_queue}:failed"

    @property
    def processing_queue(self) -> str:
        """This worker's in-flight list — the reliable-queue ack surface."""
        return f"{self.job_queue}:processing:{self.worker_id}"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        """Build settings from ``env`` (defaults to ``os.environ``)."""
        source: Mapping[str, str] = os.environ if env is None else env
        storage_root = _get(
            source,
            "WORKER_STORAGE_ROOT",
            # The API names the same directory STORAGE_LOCAL_ROOT; fall back to it
            # so a single .env serves both planes.
            _get(source, "STORAGE_LOCAL_ROOT", "./.data/storage"),
        )
        return cls(
            redis_url=_get(source, "REDIS_URL", "redis://localhost:6379"),
            job_queue=_get(source, "SHADE_JOB_QUEUE", "shade:jobs"),
            worker_shared_token=_get(
                source, "WORKER_SHARED_TOKEN", "dev-worker-token-replace-me"
            ),
            concurrency=_get_int(source, "WORKER_CONCURRENCY", 2),
            poll_timeout_seconds=_get_int(source, "WORKER_POLL_TIMEOUT_SECONDS", 5),
            processor_engine=_get(source, "PROCESSOR_ENGINE", "mock"),
            processor_version=_get(source, "PROCESSOR_VERSION", "0.1.0"),
            storage_root=Path(storage_root),
            api_public_url=_get(source, "API_PUBLIC_URL", "http://localhost:4000"),
            log_level=_get(source, "LOG_LEVEL", "INFO").upper(),
            max_attempts=_get_int(source, "WORKER_MAX_ATTEMPTS", 3),
            slow_stage_seconds=_get_float(source, "WORKER_SLOW_STAGE_SECONDS", 0.75),
            worker_id=_get(source, "WORKER_ID", _default_worker_id()),
        )
