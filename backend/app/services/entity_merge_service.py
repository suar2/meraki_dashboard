"""Persisted physical-entity merges (multi-NIC chassis)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.storage.file_store import JsonFileStore


class EntityMergeService:
    def __init__(self, store: JsonFileStore) -> None:
        self.store = store

    def _name(self, org_id: str, network_id: str) -> str:
        return f"entity_merges_{org_id}_{network_id}.json"

    def list_merges(self, org_id: str, network_id: str) -> list[dict[str, Any]]:
        payload = self.store.read_json(self._name(org_id, network_id), {"merges": []})
        if isinstance(payload, list):
            return payload
        return list(payload.get("merges") or [])

    def save_merge(self, org_id: str, network_id: str, body: dict[str, Any]) -> dict[str, Any]:
        merges = self.list_merges(org_id, network_id)
        survivor = str(body.get("survivor_id") or "")
        members = [str(m) for m in (body.get("member_ids") or []) if str(m) and str(m) != survivor]
        if not survivor or not members:
            raise ValueError("Merge requires a survivor and at least one other member.")
        incoming = {survivor, *members}
        kept: list[dict[str, Any]] = []
        for existing in merges:
            ids = {str(existing.get("survivor_id") or ""), *[str(m) for m in existing.get("member_ids") or []]}
            if ids & incoming:
                continue
            kept.append(existing)
        record = {
            "id": str(body.get("id") or uuid4()),
            "org_id": org_id,
            "network_id": network_id,
            "survivor_id": survivor,
            "member_ids": members,
            "label": str(body.get("label") or ""),
            "device_class": str(body.get("device_class") or "server"),
            "interfaces": list(body.get("interfaces") or []),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        kept.append(record)
        self.store.write_json(self._name(org_id, network_id), {"merges": kept})
        return record

    def delete_merge(self, org_id: str, network_id: str, merge_id: str) -> bool:
        merges = self.list_merges(org_id, network_id)
        kept = [item for item in merges if str(item.get("id")) != merge_id]
        if len(kept) == len(merges):
            return False
        self.store.write_json(self._name(org_id, network_id), {"merges": kept})
        return True
