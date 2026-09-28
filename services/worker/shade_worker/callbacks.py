"""Internal callback client: worker → API.

The worker holds no database credentials. Everything it reports — progress,
completion, failure — travels over three internal endpoints on the API, guarded
by a shared secret header. That keeps the trust boundary in one place: if the
worker is compromised it can misreport its own job, not read or write the rest of
the database.

Transport is stdlib ``urllib.request`` on purpose. This is a handful of JSON
POSTs; pulling in ``requests`` (and its ``urllib3``/``certifi`` chain) would add
three pinned dependencies to a container whose entire job is HTTP POST and file
writes.

Retry policy
------------
Transient failures are retried (:data:`MAX_ATTEMPTS` total, exponential backoff).
A 4xx that is not 408/429 is treated as permanent: retrying an auth failure or a
malformed payload only wastes the job's time budget, and the API has already
told us what it thinks. Progress is the one report whose failure is fatal to the
job — see :meth:`CallbackClient.report_progress`.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Mapping

from .models import (
    JobCompleteRequest,
    JobFailRequest,
    JobProgressRequest,
    to_wire,
)

__all__ = ["CallbackClient", "CallbackError"]

logger = logging.getLogger(__name__)

#: Total attempts for a single callback, including the first.
MAX_ATTEMPTS = 3

#: Base of the exponential backoff, in seconds: 0.25, 0.5, …
BACKOFF_BASE_SECONDS = 0.25

#: Per-request network timeout, in seconds.
REQUEST_TIMEOUT_SECONDS = 10.0

#: HTTP statuses worth retrying: request timeout and rate limiting.
_RETRYABLE_STATUSES = frozenset({408, 425, 429})


class CallbackError(RuntimeError):
    """Raised when a callback could not be delivered after every attempt."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class CallbackClient:
    """Posts job reports to the API's internal endpoints.

    Parameters
    ----------
    base_url:
        The API origin, e.g. ``http://localhost:4000``. An envelope's own
        ``callback.baseUrl`` wins over this when present.
    token:
        Value sent as ``X-Worker-Token``.
    dry_run:
        When true, nothing is sent. Each payload is appended to :attr:`sent`
        instead, which is how the test suite exercises the reporting path (and
        how ``--dry-run`` lets you run the worker against a queue with no API).
    opener:
        Override for the URL opener, for tests. Defaults to
        ``urllib.request.urlopen``.
    sleep:
        Override for the backoff sleep, for tests.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        dry_run: bool = False,
        opener: Callable[..., Any] | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.dry_run = dry_run
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep or time.sleep
        #: Callbacks recorded in dry-run mode: ``(path, payload)`` pairs.
        self.sent: list[tuple[str, dict[str, Any]]] = []

    # ── Public API ──────────────────────────────────────────────────────────

    def report_progress(
        self,
        job_id: str,
        request: JobProgressRequest,
        *,
        base_url: str | None = None,
    ) -> None:
        """Report a stage transition.

        Unlike completion and failure, a progress report has no alternate route
        to the UI — if it cannot be delivered the job is running blind, so this
        raises :class:`CallbackError` and the runtime fails the job. That is a
        deliberate choice: a job whose progress the user cannot see is a job the
        user will assume is hung.
        """
        self._post(job_id, "progress", to_wire(request), base_url=base_url)

    def report_complete(
        self,
        job_id: str,
        request: JobCompleteRequest,
        *,
        base_url: str | None = None,
    ) -> None:
        """Report a finished job with its artifacts, document fields and metrics."""
        self._post(job_id, "complete", to_wire(request), base_url=base_url)

    def report_fail(
        self,
        job_id: str,
        request: JobFailRequest,
        *,
        base_url: str | None = None,
    ) -> None:
        """Report a failed job, with a retryable flag the API's retry policy reads."""
        self._post(job_id, "fail", to_wire(request), base_url=base_url)

    # ── Transport ───────────────────────────────────────────────────────────

    def _url(self, job_id: str, action: str, base_url: str | None) -> str:
        origin = (base_url or self.base_url).rstrip("/")
        return f"{origin}/api/internal/jobs/{job_id}/{action}"

    def _post(
        self,
        job_id: str,
        action: str,
        payload: Mapping[str, Any],
        *,
        base_url: str | None = None,
    ) -> None:
        url = self._url(job_id, action, base_url)
        body = json.dumps(payload).encode("utf-8")

        if self.dry_run:
            logger.info(
                "callback.dry_run action=%s job_id=%s url=%s payload_keys=%s",
                action,
                job_id,
                url,
                ",".join(payload.keys()),
            )
            self.sent.append((f"/api/internal/jobs/{job_id}/{action}", dict(payload)))
            return

        last_error: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            request = urllib.request.Request(  # noqa: S310 - URL is operator-supplied config
                url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Worker-Token": self.token,
                },
            )
            try:
                with self._open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                    response.read()
                return
            except urllib.error.HTTPError as exc:
                last_error = exc
                if not self._is_retryable_status(exc.code):
                    raise CallbackError(
                        f"callback {action} rejected with HTTP {exc.code} for job "
                        f"{job_id}",
                        status=exc.code,
                    ) from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                # Connection refused, DNS failure, socket timeout, TLS error — all
                # transient until proven otherwise.
                last_error = exc

            if attempt < MAX_ATTEMPTS:
                delay = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
                logger.warning(
                    "callback.retry action=%s job_id=%s attempt=%d error=%s",
                    action,
                    job_id,
                    attempt,
                    last_error,
                )
                self._sleep(delay)

        raise CallbackError(
            f"callback {action} failed after {MAX_ATTEMPTS} attempts for job "
            f"{job_id}: {last_error}"
        )

    @staticmethod
    def _is_retryable_status(status: int) -> bool:
        """5xx and the explicitly-retryable 4xx set; everything else is final."""
        return status >= 500 or status in _RETRYABLE_STATUSES
