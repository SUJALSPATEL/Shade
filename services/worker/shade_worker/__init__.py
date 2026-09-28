"""Shade processing plane.

The Python worker that turns a queued job into artifacts. It is deliberately
split from the API: the control plane owns HTTP, auth, Postgres and the browser;
this package owns documents. The only contract between them is
``packages/shared/src/job-protocol.ts`` — a JSON envelope in, three kinds of
callback out.

Layout
------
``config``      environment-driven settings (stdlib only)
``models``      pydantic mirrors of the shared TS types and job protocol
``queue``       Redis reliable-reserve queue
``storage``     object-storage readers/writers (local now, S3 behind a protocol)
``callbacks``   worker → API progress/complete/fail POSTs
``fixtures``    the canonical mocked document, ported from the shared fixtures
``markdown``    structured document → Markdown, ported from the shared renderer
``runtime``     the consume → dispatch → report loop
``processors``  the ``DocumentProcessor`` ABC and its registered implementations

See ``services/worker/README.md`` for how to run it and how to swap in a real
engine.
"""

from __future__ import annotations

#: Version of the worker package itself (not of any processor engine — that is
#: ``PROCESSOR_VERSION``, reported in result metadata).
__version__ = "0.1.0"

__all__ = ["__version__"]
