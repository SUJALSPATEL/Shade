"""Object storage adapters.

The worker owns two directions of storage traffic:

* **reading** the raw upload the API placed in the shared object store, using the
  ``storageKey`` on the job envelope;
* **writing** the artifacts it produces (Markdown, JSON, figure assets) and
  reporting their keys back to the API.

Both are expressed as protocols so the local filesystem adapter used in
development can be swapped for S3/MinIO without touching a single processor. The
node API and the worker must agree on the key space — they point at the same
bucket/root — which is why keys are built by the *processors* from the envelope
and never invented by the adapter.

Security note
-------------
Storage keys arrive over the wire, so every adapter that maps a key onto a
filesystem path must sanitise it. :class:`LocalStorageWriter` refuses traversal
components outright and then re-checks the resolved path against the root, so a
key like ``../../etc/passwd`` fails closed rather than escaping the storage root.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

__all__ = [
    "LocalStorageReader",
    "LocalStorageWriter",
    "S3StorageWriter",
    "StorageError",
    "StorageReader",
    "StorageWriter",
    "UnsafeStorageKeyError",
    "WrittenObject",
]


class StorageError(RuntimeError):
    """Raised when a storage operation could not be completed."""


class UnsafeStorageKeyError(StorageError):
    """Raised when a storage key tries to escape the configured root."""


@dataclass(frozen=True, slots=True)
class WrittenObject:
    """What a successful write reports back, for the ``ArtifactReport``."""

    storage_key: str
    size_bytes: int
    mime_type: str


@runtime_checkable
class StorageReader(Protocol):
    """Read access to the shared object store."""

    def read(self, key: str) -> bytes:
        """Return the bytes at ``key``, raising :class:`StorageError` if absent."""
        ...

    def exists(self, key: str) -> bool:
        """Whether ``key`` resolves to a readable object."""
        ...


@runtime_checkable
class StorageWriter(Protocol):
    """Write access to the shared object store."""

    def write(self, key: str, data: bytes, mime_type: str) -> WrittenObject:
        """Persist ``data`` at ``key`` and describe what was written."""
        ...

    def write_text(self, key: str, text: str, mime_type: str) -> WrittenObject:
        """UTF-8 encode ``text`` and persist it — the common case for artifacts."""
        ...


# ── Key sanitisation ────────────────────────────────────────────────────────

#: Components that must never appear in a key, whatever the adapter.
_FORBIDDEN_COMPONENTS = frozenset({"", ".", ".."})


def sanitize_storage_key(key: str) -> tuple[str, ...]:
    """Split ``key`` into safe path components or raise.

    Rejects, in order: empty keys, absolute paths, Windows drive/UNC prefixes,
    backslashes (so one key means one thing on every platform), control
    characters, and any ``.``/``..``/empty segment. Returns the components so the
    caller can check them against its own root before touching the filesystem.
    """
    if not key or not key.strip():
        raise UnsafeStorageKeyError("storage key is empty")

    if "\x00" in key or any(ord(ch) < 32 for ch in key):
        raise UnsafeStorageKeyError(f"storage key contains control characters: {key!r}")

    if "\\" in key:
        raise UnsafeStorageKeyError(
            f"storage key must use forward slashes on every platform: {key!r}"
        )

    if key.startswith("/") or (len(key) > 1 and key[1] == ":"):
        raise UnsafeStorageKeyError(f"storage key must be relative: {key!r}")

    components = key.split("/")
    for component in components:
        if component in _FORBIDDEN_COMPONENTS:
            raise UnsafeStorageKeyError(
                f"storage key contains a traversal or empty component: {key!r}"
            )
        if component != component.strip():
            raise UnsafeStorageKeyError(
                f"storage key component has surrounding whitespace: {key!r}"
            )

    return tuple(components)


def _resolve_within_root(root: Path, key: str) -> Path:
    """Resolve ``key`` under ``root``, refusing anything that escapes it.

    The component check above already rejects ``..``, but this second check is
    what actually guarantees containment: it compares the *real* (symlink- and
    ``..``-resolved) target against the real root, so a pre-existing symlink
    inside the storage root cannot be used as an escape hatch either.
    """
    components = sanitize_storage_key(key)
    candidate = root.joinpath(*components)

    real_root = Path(os.path.realpath(root))
    # ``strict=False`` so we can validate a path that does not exist yet.
    real_target = Path(os.path.realpath(candidate))
    if real_target != real_root and real_root not in real_target.parents:
        raise UnsafeStorageKeyError(
            f"storage key {key!r} resolves outside the storage root {str(root)!r}"
        )
    return candidate


# ── Local filesystem adapter ────────────────────────────────────────────────


class LocalStorageReader:
    """Read adapter over a directory tree, used by development and tests."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root)

    def read(self, key: str) -> bytes:
        path = _resolve_within_root(self.root, key)
        try:
            return path.read_bytes()
        except FileNotFoundError as exc:
            raise StorageError(f"object not found: {key!r}") from exc
        except OSError as exc:
            raise StorageError(f"could not read object {key!r}: {exc}") from exc

    def exists(self, key: str) -> bool:
        try:
            return _resolve_within_root(self.root, key).is_file()
        except UnsafeStorageKeyError:
            return False


class LocalStorageWriter:
    """Write adapter over a directory tree (``WORKER_STORAGE_ROOT``).

    Keys map to paths beneath the root one-for-one. Writes are atomic per object:
    bytes go to a sibling temporary file that is then ``os.replace``-d into
    place, so a killed worker never leaves a half-written artifact for the API to
    serve.
    """

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root)

    def write(self, key: str, data: bytes, mime_type: str) -> WrittenObject:
        path = _resolve_within_root(self.root, key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(f".{path.name}.tmp")
            with open(temporary, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except OSError as exc:
            raise StorageError(f"could not write object {key!r}: {exc}") from exc
        return WrittenObject(
            storage_key=key, size_bytes=len(data), mime_type=mime_type
        )

    def write_text(self, key: str, text: str, mime_type: str) -> WrittenObject:
        return self.write(key, text.encode("utf-8"), mime_type)


# ── S3 adapter (stub) ───────────────────────────────────────────────────────


class S3StorageWriter:
    """S3 / MinIO adapter — declared, not yet implemented.

    The real implementation, which is why this class exists in the tree already:

    1. Reads its connection settings from the shared config
       (``S3_BUCKET``, ``S3_REGION``, ``S3_ENDPOINT``, ``S3_ACCESS_KEY_ID``,
       ``S3_SECRET_ACCESS_KEY``, ``S3_FORCE_PATH_STYLE``) and constructs a
       ``boto3.client("s3", ...)`` — or a single module-level client reused
       across worker threads, which is the point of holding it on the instance.
    2. Validates the key with :func:`sanitize_storage_key` before handing it to
       boto3. S3 has no traversal semantics, but rejecting ``..`` keeps the key
       space identical between the local and S3 drivers so a document processed
       under one driver can be read back under the other.
    3. Calls ``put_object(Bucket=..., Key=key, Body=data,
       ContentType=mime_type)``. No public ACL: artifacts are served to the
       browser through the API's own streaming route or a presigned GET, never
       by making the object world-readable.
    4. Returns a :class:`WrittenObject` whose ``size_bytes`` is the byte length
       of ``data`` — S3's own reported size is only available on a subsequent
       ``head_object`` and would cost a round trip the caller does not need.
    5. Translates ``botocore`` failures into :class:`StorageError` so callers see
       one exception vocabulary regardless of driver.

    ``read``/``exists`` follow the same shape on the reader side
    (``get_object``/``head_object``).
    """

    def __init__(self, *args: object, **kwargs: object) -> None:
        self._args = args
        self._kwargs = kwargs

    def write(self, key: str, data: bytes, mime_type: str) -> WrittenObject:
        sanitize_storage_key(key)
        raise NotImplementedError(
            "S3StorageWriter is a declared stub in this milestone; "
            "set STORAGE_DRIVER=local, or implement the boto3 put_object path "
            "described in this class's docstring."
        )

    def write_text(self, key: str, text: str, mime_type: str) -> WrittenObject:
        return self.write(key, text.encode("utf-8"), mime_type)
