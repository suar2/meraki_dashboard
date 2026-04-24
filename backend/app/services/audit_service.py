from datetime import datetime, timezone

from app.models.schemas import AuditLogEntry
from app.storage.file_store import JsonFileStore


class AuditService:
    def __init__(self, store: JsonFileStore) -> None:
        self.store = store
        self.file_name = "audit_log.json"

    def append(self, entry: AuditLogEntry) -> None:
        log = self.store.read_json(self.file_name, [])
        log.append(entry.model_dump(mode="json"))
        self.store.write_json(self.file_name, log)

    def list_recent(self, limit: int = 200) -> list[dict]:
        log = self.store.read_json(self.file_name, [])
        return list(reversed(log[-limit:]))

    @staticmethod
    def now() -> datetime:
        return datetime.now(timezone.utc)
