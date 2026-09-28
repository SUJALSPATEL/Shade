"""Shared test fixtures.

The suite is deliberately hermetic: no Redis, no network, no API. Everything the
runtime talks to is either a pure function (the processors, the fixtures, the
Markdown renderer) or a protocol the tests implement in a few lines (the queue,
the callback transport). That is a direct consequence of the processor contract —
if a test needed a Redis server to exercise a processor, the seam would be in the
wrong place.

``sys.path`` bootstrap: the tests are run from the repo root as
``python -m pytest services/worker/tests``, so ``services/worker`` (the directory
that *contains* the ``shade_worker`` package) has to be importable. Pytest only
puts a test file's own directory on the path, so the parent is added here rather
than depending on how the command is invoked. The worker's own
``pyproject.toml`` sets the same thing via ``pythonpath`` for the case where
pytest is invoked from inside ``services/worker``; this insert is what covers
every other invocation, and it is idempotent.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable

import pytest

_WORKER_ROOT = Path(__file__).resolve().parents[1]
if str(_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKER_ROOT))

from shade_worker.callbacks import CallbackClient  # noqa: E402
from shade_worker.config import Settings  # noqa: E402
from shade_worker.models import (  # noqa: E402
    JOB_PROTOCOL_VERSION,
    ExtractJobInput,
    JobEnvelope,
    ParseJobInput,
    SchemaField,
    SplitJobInput,
)
from shade_worker.runtime import Worker  # noqa: E402
from shade_worker.storage import LocalStorageReader, LocalStorageWriter  # noqa: E402


# ── Envelope construction ───────────────────────────────────────────────────


def build_envelope(
    operation: str = "PARSE",
    *,
    filename: str = "report.pdf",
    job_id: str = "job_0001",
    document_id: str = "doc_0001",
    attempt: int = 1,
    size_bytes: int = 1_024,
    storage_key: str | None = None,
    input_payload: dict[str, Any] | None = None,
    base_url: str = "http://api.test",
    token: str = "test-token",
) -> dict[str, Any]:
    """A valid job envelope as the API would serialise it (camelCase keys)."""
    if input_payload is None:
        input_payload = {
            "PARSE": {"extractImages": True, "keepFurniture": False},
            "EXTRACT": {
                "schemaName": "Financial summary",
                "fields": [
                    {"name": "company_name", "type": "string", "required": True},
                    {"name": "reporting_period", "type": "string", "required": True},
                    {"name": "total_revenue", "type": "number", "required": True},
                    {"name": "invented_field", "type": "string", "required": True},
                ],
            },
            "SPLIT": {"query": "Find the section about employee benefits.", "limit": 8},
        }[operation]

    return {
        "protocolVersion": JOB_PROTOCOL_VERSION,
        "jobId": job_id,
        "documentId": document_id,
        "operation": operation,
        "input": input_payload,
        "document": {
            "filename": filename,
            "mimeType": "application/pdf",
            "sizeBytes": size_bytes,
            "storageKey": storage_key or f"raw/{document_id}/{filename}",
        },
        "callback": {"baseUrl": base_url, "token": token},
        "attempt": attempt,
        "enqueuedAt": "2026-01-01T00:00:00.000Z",
    }


def envelope_of(operation: str, **kwargs: Any) -> JobEnvelope:
    """A validated :class:`JobEnvelope` for tests that call a processor directly."""
    return JobEnvelope.model_validate(build_envelope(operation, **kwargs))


def parse_input() -> ParseJobInput:
    return ParseJobInput(extract_images=True, keep_furniture=False)


def extract_input(fields: Iterable[SchemaField] | None = None) -> ExtractJobInput:
    return ExtractJobInput(
        schema_name="Financial summary",
        fields=list(fields)
        if fields is not None
        else [
            SchemaField(name="company_name", type="string", required=True),
            SchemaField(name="total_revenue", type="number", required=True),
            SchemaField(name="invented_field", type="string", required=True),
        ],
    )


def split_input(query: str = "Find the section about employee benefits.", limit: int = 8) -> SplitJobInput:
    return SplitJobInput(query=query, limit=limit)


# ── Fakes ───────────────────────────────────────────────────────────────────


class RecordingQueue:
    """An in-memory stand-in for :class:`RedisJobQueue`.

    Models the same three settlement verbs, so a test can assert exactly what the
    runtime did with a payload: ``acked``, ``requeued``, ``dead_lettered``.
    """

    def __init__(self, payloads: Iterable[Any] = ()) -> None:
        self.pending: list[str] = [
            payload if isinstance(payload, str) else json.dumps(payload)
            for payload in payloads
        ]
        self.acked: list[str] = []
        self.requeued: list[str] = []
        self.dead_lettered: list[tuple[str, str]] = []
        self.closed = False

    def reserve(self, timeout_seconds: int | None = None) -> str | None:
        return self.pending.pop(0) if self.pending else None

    def ack(self, payload: str) -> None:
        self.acked.append(payload)

    def requeue(self, payload: str) -> None:
        self.requeued.append(payload)

    def dead_letter(self, payload: str, reason: str) -> None:
        self.dead_lettered.append((payload, reason))

    def recover_orphans(self) -> int:
        return 0

    def queue_depth(self) -> int:
        return len(self.pending)

    def close(self) -> None:
        self.closed = True


class RecordingOpener:
    """A ``urlopen`` replacement that records requests and can be scripted.

    ``responses`` is consumed in order; each entry is either an exception to
    raise or ``None`` to succeed. Running out of entries means success, so the
    common "always works" case needs no script at all.
    """

    def __init__(self, responses: Iterable[Exception | None] | None = None) -> None:
        self.responses = list(responses or [])
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request, timeout: float = 0) -> Any:
        self.requests.append(request)
        if self.responses:
            outcome = self.responses.pop(0)
            if outcome is not None:
                raise outcome
        return _FakeResponse()

    @property
    def call_count(self) -> int:
        return len(self.requests)

    def header(self, index: int, name: str) -> str | None:
        """A request header, looked up case-insensitively.

        ``urllib`` title-cases header names on the wire, so the caller should not
        have to know whether it stored ``X-Worker-Token`` or ``x-worker-token``.
        """
        wanted = name.lower()
        for key, value in self.requests[index].headers.items():
            if key.lower() == wanted:
                return value
        return None

    def body(self, index: int) -> dict[str, Any]:
        raw = self.requests[index].data
        assert raw is not None
        return json.loads(raw.decode("utf-8"))


class _FakeResponse:
    """Minimal context-manager response; the client only calls ``read()``."""

    status = 200

    def read(self) -> bytes:
        return b"{}"

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None


def http_error(status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="http://api.test", code=status, msg="error", hdrs=None, fp=None
    )


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def storage_root(tmp_path: Path) -> Path:
    """A private object-storage root per test."""
    root = tmp_path / "storage"
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture
def settings(storage_root: Path) -> Settings:
    """Worker settings with no real Redis, no real API and a temp storage root.

    ``slow_stage_seconds`` is zero so the ``__slow__`` path costs nothing in
    tests that do not care about it; the test that *does* care overrides it.
    """
    return Settings(
        storage_root=storage_root,
        worker_id="test-worker",
        api_public_url="http://api.test",
        worker_shared_token="test-token",
        slow_stage_seconds=0.0,
    )


@pytest.fixture
def callbacks() -> CallbackClient:
    """A dry-run callback client: payloads are recorded in ``.sent``."""
    return CallbackClient("http://api.test", "test-token", dry_run=True)


@pytest.fixture
def queue() -> RecordingQueue:
    return RecordingQueue()


@pytest.fixture
def worker_factory(
    settings: Settings,
    queue: RecordingQueue,
    callbacks: CallbackClient,
    storage_root: Path,
) -> Callable[..., Worker]:
    """Build a :class:`Worker` wired entirely to fakes."""

    def factory(**overrides: Any) -> Worker:
        return Worker(
            overrides.pop("settings", settings),
            queue=overrides.pop("queue", queue),
            callbacks=overrides.pop("callbacks", callbacks),
            reader=overrides.pop("reader", LocalStorageReader(storage_root)),
            writer=overrides.pop("writer", LocalStorageWriter(storage_root)),
            now_ms=overrides.pop("now_ms", lambda: 1_735_689_600_000),
        )

    return factory


@pytest.fixture
def worker(worker_factory: Callable[..., Worker]) -> Worker:
    return worker_factory()


@pytest.fixture
def complete_calls(callbacks: CallbackClient) -> Callable[[int], dict[str, Any]]:
    """The payload of the nth ``complete`` callback recorded in dry-run mode."""

    def get(index: int = 0) -> dict[str, Any]:
        completes = [payload for path, payload in callbacks.sent if path.endswith("/complete")]
        return completes[index]

    return get


@pytest.fixture
def fail_calls(callbacks: CallbackClient) -> Callable[[int], dict[str, Any]]:
    """The payload of the nth ``fail`` callback recorded in dry-run mode."""

    def get(index: int = 0) -> dict[str, Any]:
        fails = [payload for path, payload in callbacks.sent if path.endswith("/fail")]
        return fails[index]

    return get


@pytest.fixture
def progress_calls(callbacks: CallbackClient) -> Callable[[], list[dict[str, Any]]]:
    """Every ``progress`` payload recorded in dry-run mode, in order."""

    def get() -> list[dict[str, Any]]:
        return [payload for path, payload in callbacks.sent if path.endswith("/progress")]

    return get


@pytest.fixture
def callback_paths(callbacks: CallbackClient) -> Callable[[], list[str]]:
    def get() -> list[str]:
        return [path for path, _ in callbacks.sent]

    return get
