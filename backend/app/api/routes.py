from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.schemas import AuditLogEntry, LayoutPayload, MerakiApiKeyPayload, RemediationExecuteRequest
from app.services.audit_service import AuditService
from app.services.layout_service import LayoutService
from app.services.meraki_client import MerakiAPIError, MerakiClient
from app.services.remediation_service import RemediationService
from app.services.topology_service import TopologyService
from app.services.validation_service import ValidationService
from app.storage.file_store import JsonFileStore

router = APIRouter(prefix="/api")

store = JsonFileStore(settings.data_dir)
meraki = MerakiClient()
layout_service = LayoutService(store)
audit_service = AuditService(store)
topology_service = TopologyService(meraki, ValidationService(), layout_service, store)
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


@router.post("/layout")
async def save_layout(payload: LayoutPayload):
    layout_service.save_positions(payload.org_id, payload.network_id, payload.positions)
    return {"status": "ok"}


@router.get("/layout/{org_id}/{network_id}")
async def load_layout(org_id: str, network_id: str):
    return layout_service.get_positions(org_id, network_id)


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
                device_serial=payload.action.target_device_serial,
                port_id=payload.action.target_port_id,
                issue_id=payload.action.issue_id,
                previous_config=payload.action.current_values,
                new_config=payload.action.proposed_values,
                outcome=f"failure: {exc}",
                api_response={},
            )
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
