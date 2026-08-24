"""Persisted saved views and logical device groups."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.storage.file_store import JsonFileStore


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ViewService:
    def __init__(self, store: JsonFileStore) -> None:
        self.store = store

    def _view_name(self, org_id: str, network_id: str) -> str:
        return f"saved_views_{org_id}_{network_id}.json"

    def _group_name(self, org_id: str, network_id: str) -> str:
        return f"logical_groups_{org_id}_{network_id}.json"

    def list_views(self, org_id: str, network_id: str) -> list[dict[str, Any]]:
        payload = self.store.read_json(self._view_name(org_id, network_id), {"views": []})
        return list(payload.get("views") or [])

    def save_view(self, org_id: str, network_id: str, body: dict[str, Any]) -> dict[str, Any]:
        views = self.list_views(org_id, network_id)
        view_id = str(body.get("id") or uuid4())
        record = {
            "id": view_id,
            "name": str(body.get("name") or "Untitled view").strip() or "Untitled view",
            "starred": bool(body.get("starred")),
            "shared": True,
            "org_id": org_id,
            "network_id": network_id,
            "view_mode": str(body.get("view_mode") or "physical_clients"),
            "selected_nodes": list(body.get("selected_nodes") or []),
            "hidden_nodes": list(body.get("hidden_nodes") or []),
            "focus_nodes": list(body.get("focus_nodes") or []),
            "expanded_groups": list(body.get("expanded_groups") or []),
            "filters": dict(body.get("filters") or {}),
            "positions": dict(body.get("positions") or {}),
            "zoom": body.get("zoom"),
            "pan": dict(body.get("pan") or {}),
            "selected_ports": list(body.get("selected_ports") or []),
            "highlighted_path": list(body.get("highlighted_path") or []),
            "layout": str(body.get("layout") or "breadthfirst"),
            "collapse_wireless": body.get("collapse_wireless", True),
            "collapse_downstream": body.get("collapse_downstream", True),
            "updated_at": _now(),
        }
        existing = next((v for v in views if v.get("id") == view_id), None)
        if existing:
            record["created_at"] = existing.get("created_at") or _now()
            views = [record if v.get("id") == view_id else v for v in views]
        else:
            record["created_at"] = _now()
            views.append(record)
        views.sort(key=lambda v: (not v.get("starred"), str(v.get("name") or "").lower()))
        self.store.write_json(self._view_name(org_id, network_id), {"views": views})
        return record

    def delete_view(self, org_id: str, network_id: str, view_id: str) -> bool:
        views = self.list_views(org_id, network_id)
        kept = [v for v in views if str(v.get("id")) != view_id]
        if len(kept) == len(views):
            return False
        self.store.write_json(self._view_name(org_id, network_id), {"views": kept})
        return True

    def list_groups(self, org_id: str, network_id: str) -> list[dict[str, Any]]:
        payload = self.store.read_json(self._group_name(org_id, network_id), {"groups": []})
        return list(payload.get("groups") or [])

    def save_group(self, org_id: str, network_id: str, body: dict[str, Any]) -> dict[str, Any]:
        groups = self.list_groups(org_id, network_id)
        group_id = str(body.get("id") or uuid4())
        record = {
            "id": group_id,
            "name": str(body.get("name") or "Untitled group").strip() or "Untitled group",
            "member_ids": list(body.get("member_ids") or []),
            "org_id": org_id,
            "network_id": network_id,
            "updated_at": _now(),
        }
        existing = next((g for g in groups if g.get("id") == group_id), None)
        if existing:
            record["created_at"] = existing.get("created_at") or _now()
            groups = [record if g.get("id") == group_id else g for g in groups]
        else:
            record["created_at"] = _now()
            groups.append(record)
        self.store.write_json(self._group_name(org_id, network_id), {"groups": groups})
        return record

    def delete_group(self, org_id: str, network_id: str, group_id: str) -> bool:
        groups = self.list_groups(org_id, network_id)
        kept = [g for g in groups if str(g.get("id")) != group_id]
        if len(kept) == len(groups):
            return False
        self.store.write_json(self._group_name(org_id, network_id), {"groups": kept})
        return True
