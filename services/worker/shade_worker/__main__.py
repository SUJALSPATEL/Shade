"""Entry point: ``python -m shade_worker``.

Startup order matters and is deliberate:

1. **Configure logging first**, so an error in any later step is formatted like
   everything else rather than printed by Python's default handler.
2. **Build settings**, which validates the environment (a non-numeric
   ``WORKER_CONCURRENCY`` fails here, not at the first job).
3. **Register pluggable engines**, so ``PROCESSOR_ENGINE`` naming an
   entry-point engine resolves before the first job arrives.
4. **Recover orphans** for this worker id — anything a previous process with the
   same id left in its processing list is pushed back for redelivery.
5. **Run.**

Pass ``--once`` to handle a single job and exit (a smoke test against a real
queue), ``--dry-run`` to run without touching the API, and ``--check`` to
validate configuration and exit without consuming anything.
"""

from __future__ import annotations

import argparse
import logging
import sys

from . import __version__
from .callbacks import CallbackClient
from .config import Settings
from .processors.registry import (
    EngineRegistryError,
    load_entry_point_engines,
    registered_operations,
)
from .runtime import Worker, configure_logging

__all__ = ["build_parser", "main"]

logger = logging.getLogger("shade_worker.__main__")


def build_parser() -> argparse.ArgumentParser:
    """The CLI surface. Kept in a function so tests can assert on it."""
    parser = argparse.ArgumentParser(
        prog="shade_worker",
        description="Shade processing-plane worker: consumes document jobs from Redis.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="reserve and handle a single job, then exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="log callbacks instead of POSTing them to the API",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate configuration and engine registration, then exit",
    )
    parser.add_argument(
        "--log-level",
        default=None,
        help="override LOG_LEVEL (DEBUG, INFO, WARNING, ERROR)",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"shade-worker {__version__}",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns a process exit code."""
    args = build_parser().parse_args(argv)

    settings = Settings.from_env()
    configure_logging(args.log_level or settings.log_level)

    try:
        entry_point_engines = load_entry_point_engines()
    except Exception as exc:  # noqa: BLE001 - a broken third-party wheel is not fatal
        logger.warning("engine.entry_point_load_failed error=%s", exc)
        entry_point_engines = ()
    if entry_point_engines:
        logger.info("engine.registered_from_entry_points names=%s", list(entry_point_engines))

    if not registered_operations(settings.processor_engine):
        logger.error(
            "engine.no_operations engine=%s registered=%s",
            settings.processor_engine,
            list(registered_operations(settings.processor_engine)),
        )
        return 2

    callbacks = CallbackClient(
        settings.api_public_url,
        settings.worker_shared_token,
        dry_run=args.dry_run,
    )

    worker = Worker(settings, callbacks=callbacks)

    if args.check:
        return _check(worker, settings, dry_run=args.dry_run)

    try:
        _recover_orphans(worker)
    except Exception as exc:  # noqa: BLE001 - refuse to start on an unknown queue
        logger.error("worker.orphan_recovery_failed error=%s", exc)
        return 1

    try:
        return worker.run(once=args.once)
    except EngineRegistryError as exc:
        logger.error("engine.registry_error error=%s", exc)
        return 2


def _check(worker: Worker, settings: Settings, *, dry_run: bool) -> int:
    """Validate configuration and connectivity without consuming a job."""
    logger.info(
        "check.config worker_id=%s engine=%s operations=%s queue=%s storage_root=%s dry_run=%s",
        settings.worker_id,
        settings.processor_engine,
        list(registered_operations(settings.processor_engine)),
        settings.job_queue,
        settings.storage_root,
        dry_run,
    )
    try:
        depth = worker.queue.queue_depth()
    except Exception as exc:  # noqa: BLE001 - the point of --check is to report this
        logger.error("check.redis_unreachable url=%s error=%s", settings.redis_url, exc)
        return 1
    logger.info("check.redis_ok url=%s pending=%d", settings.redis_url, depth)

    try:
        settings.storage_root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error("check.storage_unwritable root=%s error=%s", settings.storage_root, exc)
        return 1
    logger.info("check.storage_ok root=%s", settings.storage_root)
    return 0


def _recover_orphans(worker: Worker) -> None:
    """Return this worker id's stranded jobs to the pending list.

    Must run before any consumer thread starts, or a recovered payload could race
    a fresh reservation of the same item.
    """
    recovered = worker.queue.recover_orphans()
    logger.info("worker.orphan_recovery_complete recovered=%d", recovered)


if __name__ == "__main__":
    sys.exit(main())
