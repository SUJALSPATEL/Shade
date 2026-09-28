"""Ad-hoc smoke test used during development (not part of the pytest suite)."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from shade_worker.callbacks import CallbackClient
from shade_worker.config import Settings
from shade_worker.processors.split import retrieve
from shade_worker.runtime import Worker
from shade_worker.storage import LocalStorageReader, LocalStorageWriter


def envelope(operation):
    doc = {
        "filename": "report.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 1024,
        "storageKey": "raw/doc_1/x.pdf",
    }
    if operation == "PARSE":
        payload = {"extractImages": True, "keepFurniture": False}
    elif operation == "EXTRACT":
        payload = {
            "schemaName": "Financial summary",
            "fields": [
                {"name": "company_name", "type": "string", "required": True},
                {"name": "total_revenue", "type": "number", "required": True},
                {"name": "regions", "type": "array<object>", "required": False},
                {"name": "nonsense_field", "type": "string", "required": True},
            ],
        }
    else:
        payload = {"query": "Find the section about employee benefits.", "limit": 8}
    return {
        "protocolVersion": 1,
        "jobId": f"job_{operation}",
        "documentId": "doc_1",
        "operation": operation,
        "input": payload,
        "document": doc,
        "callback": {"baseUrl": "http://localhost:4000", "token": "t"},
        "attempt": 1,
        "enqueuedAt": "2026-09-28T00:00:00.000Z",
    }


class FakeQueue:
    def __init__(self, items):
        self.items = list(items)
        self.dead = []
        self.acked = []

    def reserve(self, timeout_seconds=None):
        return self.items.pop(0) if self.items else None

    def ack(self, payload):
        self.acked.append(payload)

    def requeue(self, payload):
        self.items.append(payload)

    def dead_letter(self, payload, reason):
        self.dead.append(reason)

    def close(self):
        pass


root = Path(tempfile.mkdtemp())
settings = Settings(storage_root=root, worker_id="dev-check")
callbacks = CallbackClient("http://localhost:4000", "t", dry_run=True)
q = FakeQueue(json.dumps(envelope(op)) for op in ("PARSE", "EXTRACT", "SPLIT"))
worker = Worker(
    settings,
    queue=q,
    callbacks=callbacks,
    reader=LocalStorageReader(root),
    writer=LocalStorageWriter(root),
)
for _ in range(3):
    worker.handle_one()

print("--- files ---")
for path in sorted(root.rglob("*")):
    if path.is_file():
        print(" ", path.relative_to(root), path.stat().st_size)

print("--- markdown ---")
print((root / "artifacts/doc_1/parse/document.md").read_text(encoding="utf-8"))

print("--- svg ---")
print((root / "artifacts/doc_1/parse/assets/image-001.svg").read_text(encoding="utf-8"))

print("--- progress callbacks (parse) ---")
for path, payload in callbacks.sent:
    if "job_PARSE" in path:
        print(" ", payload)

print("--- complete payload (parse) ---")
for path, payload in callbacks.sent:
    if path.endswith("/complete") and "job_PARSE" in path:
        print(json.dumps({k: v for k, v in payload.items() if k != "metrics"}, indent=1)[:600])
        print("metrics keys:", list(payload["metrics"].keys()))
        print("chunk[0]:", json.dumps(payload["metrics"]["chunks"][0]))
        print("chunk count:", len(payload["metrics"]["chunks"]))

print("--- extract payload ---")
for path, payload in callbacks.sent:
    if "job_EXTRACT" in path:
        print(" ", path.rsplit("/", 1)[-1], json.dumps(payload)[:400])
print((root / "artifacts/doc_1/extract/extract.json").read_text(encoding="utf-8")[:900])

print("--- split match order ---")
for m in retrieve("Find the section about employee benefits."):
    print(f"  {m.chunk_id} {m.score} {m.rationale}")

print("--- extract.json chunk metrics / dead letters ---")
print("dead:", q.dead)
