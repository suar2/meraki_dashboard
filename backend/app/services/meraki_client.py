from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class MerakiAPIError(Exception):
    pass


class MerakiClient:
    def __init__(self) -> None:
        self.base_url = str(settings.meraki_base_url).rstrip("/")
        self.api_key = settings.meraki_api_key

    def set_api_key(self, api_key: str) -> None:
        self.api_key = api_key.strip()

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise MerakiAPIError("Meraki API key is not set. Enter it in the dashboard first.")
        return {
            "X-Cisco-Meraki-API-Key": self.api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self.base_url}{path}"
        timeout = httpx.Timeout(settings.request_timeout_seconds)
        retries = max(settings.max_retries, 0)
        backoff = max(settings.retry_backoff_seconds, 1)
        attempt = 0
        while True:
            attempt += 1
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.request(method, url, headers=self._headers(), **kwargs)
            except httpx.HTTPError as exc:
                if attempt > retries:
                    raise MerakiAPIError(f"Meraki request failed after retries: {exc}") from exc
                sleep_for = backoff * (2 ** (attempt - 1))
                logger.warning("Meraki request transport error, retrying in %ss (attempt %s/%s)", sleep_for, attempt, retries)
                await asyncio.sleep(sleep_for)
                continue

            if response.status_code == 401:
                raise MerakiAPIError("Invalid Meraki API key. Update MERAKI_API_KEY in .env.")
            if response.status_code == 429:
                if attempt > retries:
                    raise MerakiAPIError("Meraki API rate limit reached after retries. Try again shortly.")
                retry_after = response.headers.get("Retry-After")
                sleep_for = int(retry_after) if retry_after and retry_after.isdigit() else backoff * (2 ** (attempt - 1))
                logger.warning("Meraki API rate limit hit, retrying in %ss (attempt %s/%s)", sleep_for, attempt, retries)
                await asyncio.sleep(sleep_for)
                continue
            if response.status_code >= 500 and attempt <= retries:
                sleep_for = backoff * (2 ** (attempt - 1))
                logger.warning("Meraki server error %s, retrying in %ss (attempt %s/%s)", response.status_code, sleep_for, attempt, retries)
                await asyncio.sleep(sleep_for)
                continue
            if response.status_code >= 400:
                raise MerakiAPIError(f"Meraki request failed {response.status_code}: {response.text}")
            return response.json()

    async def get_organizations(self) -> list[dict[str, Any]]:
        return await self._request("GET", "/organizations")

    async def get_organization_networks(self, org_id: str) -> list[dict[str, Any]]:
        return await self._request("GET", f"/organizations/{org_id}/networks")

    async def get_network_devices(self, network_id: str) -> list[dict[str, Any]]:
        return await self._request("GET", f"/networks/{network_id}/devices")

    async def get_network_topology(self, network_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/networks/{network_id}/topology/linkLayer")

    async def get_switch_ports(self, serial: str) -> list[dict[str, Any]]:
        return await self._request("GET", f"/devices/{serial}/switch/ports")

    async def get_device_lldp_cdp(self, serial: str) -> dict[str, Any]:
        return await self._request("GET", f"/devices/{serial}/lldpCdp")

    async def get_switch_port_statuses(self, serial: str) -> list[dict[str, Any]]:
        return await self._request("GET", f"/devices/{serial}/switch/ports/statuses")

    async def get_network_clients(self, network_id: str, timespan: int = 3600) -> list[dict[str, Any]]:
        return await self._request("GET", f"/networks/{network_id}/clients", params={"timespan": timespan, "perPage": 1000})

    async def update_switch_port(self, serial: str, port_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PUT", f"/devices/{serial}/switch/ports/{port_id}", json=payload)

    async def validate_credentials(self) -> None:
        await self.get_organizations()
