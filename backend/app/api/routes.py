from fastapi import APIRouter, Depends, Header, HTTPException

from app.models.schemas import (
    EntityMergeRequest,
    LayoutPayload,
    LogicalGroupPayload,
    RemediationExecuteRequest,
    SavedViewPayload,
)
from app.services.live_expectations import validate_expectations
from app.services.meraki_client import MerakiAPIError, MerakiClient
from app.services.remediation_service import RemediationService
from app.services.topology_service import TopologyService
from app.services.validation_service import ValidationService

router = APIRouter(prefix="/api")

validator = ValidationService()


def get_meraki_client(
    x_meraki_api_key: str | None = Header(default=None, alias="X-Meraki-Api-Key"),
) -> MerakiClient:
    key = (x_meraki_api_key or "").strip()
    if not key:
        raise HTTPException(status_code=401, detail="Meraki API key required")
    return MerakiClient(api_key=key)


def get_topology_service(meraki: MerakiClient = Depends(get_meraki_client)) -> TopologyService:
    return TopologyService(meraki, validator, layouts=None, store=None, history=None)


def privacy_mode_unavailable(feature: str) -> None:
    raise HTTPException(status_code=410, detail=f"{feature} is unavailable in strict privacy mode.")


@router.get("/organizations")
async def organizations(meraki: MerakiClient = Depends(get_meraki_client)):
    try:
        return await meraki.get_organizations()
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/organizations/{org_id}/networks")
async def networks(org_id: str, meraki: MerakiClient = Depends(get_meraki_client)):
    try:
        return await meraki.get_organization_networks(org_id)
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/topology/{org_id}/{network_id}")
async def topology(
    org_id: str,
    network_id: str,
    topology_service: TopologyService = Depends(get_topology_service),
):
    try:
        return await topology_service.build(org_id, network_id)
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/entities/merges/{org_id}/{network_id}")
async def list_entity_merges(org_id: str, network_id: str):
    return []


@router.post("/entities/merge")
async def save_entity_merge(payload: EntityMergeRequest):
    privacy_mode_unavailable("Server-side entity merges")


@router.delete("/entities/merge/{org_id}/{network_id}/{merge_id}")
async def delete_entity_merge(org_id: str, network_id: str, merge_id: str):
    privacy_mode_unavailable("Server-side entity merges")


@router.post("/layout")
async def save_layout(payload: LayoutPayload):
    return {"status": "ok", "mode": "browser-only"}


@router.get("/layout/{org_id}/{network_id}")
async def load_layout(org_id: str, network_id: str):
    return {}


@router.get("/topology/{org_id}/{network_id}/changes")
async def topology_changes(org_id: str, network_id: str, window: str = "24h"):
    return {"window": window, "changes": [], "snapshots": []}


@router.get("/topology/{org_id}/{network_id}/validate")
async def topology_validate(
    org_id: str,
    network_id: str,
    topology_service: TopologyService = Depends(get_topology_service),
):
    try:
        graph = await topology_service.build(org_id, network_id)
    except MerakiAPIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return validate_expectations(graph)


@router.get("/views/{org_id}/{network_id}")
async def list_views(org_id: str, network_id: str):
    return []


@router.post("/views/{org_id}/{network_id}")
async def save_view(org_id: str, network_id: str, payload: SavedViewPayload):
    privacy_mode_unavailable("Shared views")


@router.delete("/views/{org_id}/{network_id}/{view_id}")
async def delete_view(org_id: str, network_id: str, view_id: str):
    privacy_mode_unavailable("Shared views")


@router.get("/groups/{org_id}/{network_id}")
async def list_groups(org_id: str, network_id: str):
    return []


@router.post("/groups/{org_id}/{network_id}")
async def save_group(org_id: str, network_id: str, payload: LogicalGroupPayload):
    privacy_mode_unavailable("Shared groups")


@router.delete("/groups/{org_id}/{network_id}/{group_id}")
async def delete_group(org_id: str, network_id: str, group_id: str):
    privacy_mode_unavailable("Shared groups")


@router.get("/audit")
async def audit():
    return []


@router.post("/remediation/execute")
async def remediation_execute(
    payload: RemediationExecuteRequest,
    meraki: MerakiClient = Depends(get_meraki_client),
):
    remediation_service = RemediationService(meraki, audit=None)
    try:
        return await remediation_service.apply(payload)
    except (MerakiAPIError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
