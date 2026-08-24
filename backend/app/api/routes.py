from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.schemas import (
    AuditLogEntry,
    EntityMergeRequest,
    LayoutPayload,
    LogicalGroupPayload,
    MerakiApiKeyPayload,
    RemediationExecuteRequest,
    SavedViewPayload,
)
from app.services.audit_service import AuditService
from app.services.history_service import HistoryService
from app.services.layout_service import LayoutService
from app.services.live_expectations import validate_expectations
from app.services.meraki_client import MerakiAPIError, MerakiClient
from app.services.remediation_service import RemediationService
from app.services.topology_service import TopologyService
from app.services.validation_service import ValidationService
from app.services.view_service import ViewService
from app.storage.file_store import JsonFileStore

router = APIRouter(prefix="/api")

store = JsonFileStore(settings.data_dir)
meraki = MerakiClient()
layout_service = LayoutService(store)
audit_service = AuditService(store)
history_service = HistoryService(store)
view_service = ViewService(store)
topology_service = TopologyService(meraki, ValidationService(), layout_service, store, history_service)
remediation_service = RemediationService(meraki, audit_service)


@router.get("/organizations")
async def organizations():
    try:
        return await meraki.get_organizations()
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/meraki-api-key")
async def set_meraki_api_key(payload: MerakiApiKeyPayload):
    key = payload.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty.")
    meraki.set_api_key(key)
    try:
        await meraki.validate_credentials()
    except MerakiAPIError as exc:
        meraki.set_api_key("")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/organizations/{org_id}/networks")
async def networks(org_id: str):
    try:
        return await meraki.get_organization_networks(org_id)
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/topology/{org_id}/{network_id}")
async def topology(org_id: str, network_id: str):
    try:
        return await topology_service.build(org_id, network_id)
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/entities/merges/{org_id}/{network_id}")
async def list_entity_merges(org_id: str, network_id: str):
    return topology_service.entity_merges.list_merges(org_id, network_id)


@router.post("/entities/merge")
async def save_entity_merge(payload: EntityMergeRequest):
    try:
        record = topology_service.entity_merges.save_merge(
            payload.org_id,
            payload.network_id,
            payload.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    topology_service.invalidate_cache(payload.org_id, payload.network_id)
    return record


@router.delete("/entities/merge/{org_id}/{network_id}/{merge_id}")
async def delete_entity_merge(org_id: str, network_id: str, merge_id: str):
    deleted = topology_service.entity_merges.delete_merge(org_id, network_id, merge_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Merge not found.")
    topology_service.invalidate_cache(org_id, network_id)
    return {"status": "ok"}


@router.post("/layout")
async def save_layout(payload: LayoutPayload):
    layout_service.save_positions(payload.org_id, payload.network_id, payload.positions)
    return {"status": "ok"}


@router.get("/layout/{org_id}/{network_id}")
async def load_layout(org_id: str, network_id: str):
    return layout_service.get_positions(org_id, network_id)


@router.get("/topology/{org_id}/{network_id}/changes")
async def topology_changes(org_id: str, network_id: str, window: str = "24h"):
    return {
        "window": window,
        "changes": history_service.list_changes(org_id, network_id, window),
        "snapshots": [
            {"id": s.get("id"), "captured_at": s.get("captured_at"), "node_count": len(s.get("nodes") or {})}
            for s in history_service.list_snapshots(org_id, network_id)
        ],
    }


@router.get("/topology/{org_id}/{network_id}/validate")
async def topology_validate(org_id: str, network_id: str):
    try:
        graph = await topology_service.build(org_id, network_id)
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return validate_expectations(graph)


@router.get("/views/{org_id}/{network_id}")
async def list_views(org_id: str, network_id: str):
    return view_service.list_views(org_id, network_id)


@router.post("/views/{org_id}/{network_id}")
async def save_view(org_id: str, network_id: str, payload: SavedViewPayload):
    return view_service.save_view(org_id, network_id, payload.model_dump())


@router.delete("/views/{org_id}/{network_id}/{view_id}")
async def delete_view(org_id: str, network_id: str, view_id: str):
    if not view_service.delete_view(org_id, network_id, view_id):
        raise HTTPException(status_code=404, detail="View not found.")
    return {"status": "ok"}


@router.get("/groups/{org_id}/{network_id}")
async def list_groups(org_id: str, network_id: str):
    return view_service.list_groups(org_id, network_id)


@router.post("/groups/{org_id}/{network_id}")
async def save_group(org_id: str, network_id: str, payload: LogicalGroupPayload):
    return view_service.save_group(org_id, network_id, payload.model_dump())


@router.delete("/groups/{org_id}/{network_id}/{group_id}")
async def delete_group(org_id: str, network_id: str, group_id: str):
    if not view_service.delete_group(org_id, network_id, group_id):
        raise HTTPException(status_code=404, detail="Group not found.")
    return {"status": "ok"}


@router.get("/audit")
async def audit():
    return audit_service.list_recent()


@router.post("/remediation/execute")
async def remediation_execute(payload: RemediationExecuteRequest):
    try:
        return await remediation_service.apply(payload)
    except (MerakiAPIError, ValueError) as exc:
        audit_service.append(
            AuditLogEntry(
                timestamp=audit_service.now(),
                actor=payload.actor,
                org_id=payload.org_id,
                network_id=payload.network_id,
                device_serial=payload.action.target_device_serial,
                port_id=payload.action.target_port_id,
                issue_id=payload.action.issue_id,
                issue_category=str(payload.action.action_type),
                previous_config=payload.action.current_values,
                proposed_config=payload.action.proposed_values,
                new_config={},
                outcome=f"failure: {exc}",
                api_response={},
            )
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
