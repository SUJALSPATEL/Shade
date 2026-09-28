"""Processor registry — the single swap point for a real engine.

``get_processor`` is the only place in the worker that decides *which*
implementation runs an operation. Everything upstream (queue, runtime) and
everything downstream (storage, callbacks) is written against the
:class:`~shade_worker.processors.base.DocumentProcessor` ABC, so introducing a
real engine is:

1. Write ``class OcrParseProcessor(DocumentProcessor)`` with
   ``operation == "PARSE"``, in a module of your choosing.
2. Register it::

       from shade_worker.processors.registry import register_engine
       register_engine("ocr-layout", {"PARSE": OcrParseProcessor})

   (or, for a distributable package, expose it under the
   ``shade_worker.processors`` entry-point group — see ``load_entry_point_engines``.)
3. Set ``PROCESSOR_ENGINE=ocr-layout``.

No edit to ``queue.py``, ``runtime.py`` or ``callbacks.py``. That constraint is
the entire reason this indirection exists: the day a real engine lands, the
diff should be one new module plus one registration line.

An engine may implement only some operations. Registering ``{"PARSE": …}`` alone
is legal — the consumer of ``get_processor`` has no "all operations" assumption,
and an operation with no processor is a typed failure, not a crash.
"""

from __future__ import annotations

import logging
from typing import Callable, Mapping

from ..config import Settings
from ..models import Operation
from .base import MOCK_ENGINE, DocumentProcessor
from .extract import ExtractProcessor
from .parse import ParseProcessor
from .split import SplitProcessor

__all__ = [
    "EngineRegistryError",
    "UnknownOperationError",
    "available_engines",
    "get_processor",
    "register_engine",
    "registered_operations",
]

logger = logging.getLogger(__name__)

#: A zero-argument callable returning a fresh processor. Factories rather than
#: instances because processors are stateless and shared across consumer threads,
#: but an engine whose model handle is per-thread should not have to be.
ProcessorFactory = Callable[[], DocumentProcessor]


class EngineRegistryError(LookupError):
    """Raised when no processor can be resolved for an engine/operation pair."""


class UnknownOperationError(EngineRegistryError):
    """Raised when an operation has no processor in the selected engine.

    Distinct from a malformed envelope: reaching this means the job was
    well-formed and the worker simply cannot do it, so the runtime reports
    ``UNSUPPORTED_FORMAT`` rather than the generic malformed-payload path.
    """


#: The deterministic fixture engine. This is what ``PROCESSOR_ENGINE=mock`` means.
MOCK_PROCESSORS: Mapping[Operation, ProcessorFactory] = {
    "PARSE": ParseProcessor,
    "EXTRACT": ExtractProcessor,
    "SPLIT": SplitProcessor,
}

#: Engine name → operation → factory.
_ENGINES: dict[str, Mapping[Operation, ProcessorFactory]] = {
    MOCK_ENGINE: MOCK_PROCESSORS
}


def register_engine(name: str, processors: Mapping[Operation, ProcessorFactory]) -> None:
    """Register (or replace) an engine's processor table.

    Replacing is allowed and intentional: it is how a test substitutes a fake
    processor, and how an operator pins an older engine implementation without
    editing this module.
    """
    if not name:
        raise ValueError("engine name must be non-empty")
    unknown = [op for op in processors if op not in MOCK_PROCESSORS]
    if unknown:
        raise ValueError(f"unknown operation(s) for engine {name!r}: {unknown}")
    _ENGINES[name] = dict(processors)
    logger.debug("registry.engine_registered name=%s operations=%s", name, sorted(processors))


def available_engines() -> tuple[str, ...]:
    """Every registered engine name, sorted."""
    return tuple(sorted(_ENGINES))


def registered_operations(engine: str) -> tuple[Operation, ...]:
    """Operations ``engine`` can serve, sorted. Empty for an unknown engine."""
    return tuple(sorted(_ENGINES.get(engine, {})))


def get_processor(
    operation: Operation,
    settings: Settings | None = None,
    *,
    engine: str | None = None,
) -> DocumentProcessor:
    """Resolve a processor instance for ``operation``.

    Parameters
    ----------
    operation:
        The operation to serve.
    settings:
        Supplies ``processor_engine`` when ``engine`` is not given.
    engine:
        Explicit engine name, overriding ``settings``.

    Raises
    ------
    EngineRegistryError
        The engine is not registered. Callers should treat this as a
        configuration error and refuse to start, not as a per-job failure.
    UnknownOperationError
        The engine is registered but does not serve this operation.
    """
    name = engine if engine is not None else (settings.processor_engine if settings else MOCK_ENGINE)
    table = _ENGINES.get(name)
    if table is None:
        raise EngineRegistryError(
            f"engine {name!r} is not registered; available: {list(available_engines())}"
        )
    factory = table.get(operation)
    if factory is None:
        raise UnknownOperationError(
            f"engine {name!r} does not implement {operation}; "
            f"it serves {list(registered_operations(name))}"
        )
    return factory()


def load_entry_point_engines(group: str = "shade_worker.processors") -> tuple[str, ...]:
    """Register engines advertised by installed packages, returning their names.

    This is the distribution story: a real engine ships as its own wheel, declares
    an entry point, and becomes selectable via ``PROCESSOR_ENGINE`` without the
    worker being rebuilt. The base install declares no entry points, so this is a
    no-op today — but it is the mechanism, not a placeholder for one.
    """
    from importlib.metadata import entry_points

    registered: list[str] = []
    for entry_point in entry_points(group=group):
        loader = entry_point.load()
        table = loader() if callable(loader) else loader
        register_engine(entry_point.name, table)
        registered.append(entry_point.name)
    return tuple(sorted(registered))
