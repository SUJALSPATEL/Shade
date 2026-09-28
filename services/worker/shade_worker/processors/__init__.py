"""Processing operations.

Each module here implements one operation behind the
:class:`~shade_worker.processors.base.DocumentProcessor` ABC. ``registry`` maps
``PROCESSOR_ENGINE`` + ``Operation`` onto an implementation and is the only
supported way to add one.

``base`` is the interesting module: it documents the pipeline stages, defines the
context a processor is given, and states the two properties every implementation
must have — idempotence (redelivery is expected) and determinism (the same
envelope must produce the same bytes).
"""

from __future__ import annotations

from .base import (
    FAIL_MARKER,
    MOCK_ENGINE,
    SLOW_MARKER,
    STAGE_PERCENT,
    DocumentProcessor,
    ProcessingContext,
    ProcessorFailure,
)
from .extract import ExtractProcessor
from .parse import ParseProcessor
from .registry import (
    EngineRegistryError,
    UnknownOperationError,
    available_engines,
    get_processor,
    register_engine,
)
from .split import SplitProcessor

__all__ = [
    "DocumentProcessor",
    "EngineRegistryError",
    "ExtractProcessor",
    "FAIL_MARKER",
    "MOCK_ENGINE",
    "ParseProcessor",
    "ProcessingContext",
    "ProcessorFailure",
    "SLOW_MARKER",
    "STAGE_PERCENT",
    "SplitProcessor",
    "UnknownOperationError",
    "available_engines",
    "get_processor",
    "register_engine",
]
