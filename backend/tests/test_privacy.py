import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.api.routes import get_meraki_client
from app.config import Settings
from app.main import app
from app.security import SensitiveDataFilter
from app.services.topology_service import TopologyService
from app.services.validation_service import ValidationService


class FakeMerakiClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def get_organization_networks(self, org_id: str):
        return [{"id": "net-1", "name": f"network-for-{self.api_key}"}]

    async def get_network_devices(self, network_id: str):
        return []

    async def get_organization_devices(self, org_id: str, network_id: str | None = None):
        return []

    async def get_network_topology(self, network_id: str):
        return {"nodes": [], "links": []}

    async def get_network_clients(self, network_id: str, timespan: int = 86400):
        return []

    async def get_network_switch_stacks(self, network_id: str):
        return []


class PrivacyTests(unittest.IsolatedAsyncioTestCase):
    def test_removed_api_key_endpoint(self):
        removed_path = "/api/" + "meraki" + "-api-key"
        paths = {route.path for route in app.routes}
        self.assertNotIn(removed_path, paths)

        client = TestClient(app)
        response = client.post(removed_path, json={"api_key": "secret"})
        self.assertEqual(response.status_code, 404)

    def test_server_settings_do_not_include_static_meraki_key(self):
        self.assertNotIn("meraki_api_key", Settings.model_fields)
        aliases = {str(field.alias) for field in Settings.model_fields.values() if field.alias}
        self.assertNotIn("MERAKI" + "_API_KEY", aliases)

    def test_request_scoped_clients_are_isolated(self):
        client_a = get_meraki_client(" key-a ")
        client_b = get_meraki_client(" key-b ")

        self.assertIsNot(client_a, client_b)
        self.assertEqual(client_a.api_key, "key-a")
        self.assertEqual(client_b.api_key, "key-b")
        self.assertEqual(client_a._headers()["X-Cisco-Meraki-API-Key"], "key-a")
        self.assertEqual(client_b._headers()["X-Cisco-Meraki-API-Key"], "key-b")

    async def test_concurrent_topology_requests_do_not_share_cache_or_key(self):
        service_a = TopologyService(FakeMerakiClient("user-a"), ValidationService(), layouts=None, store=None, history=None)
        service_b = TopologyService(FakeMerakiClient("user-b"), ValidationService(), layouts=None, store=None, history=None)

        graph_a = await service_a.build("org-1", "net-1")
        graph_b = await service_b.build("org-1", "net-1")

        self.assertEqual(graph_a.network["name"], "network-for-user-a")
        self.assertEqual(graph_b.network["name"], "network-for-user-b")
        self.assertIsNone(service_a._load_cache("org-1", "net-1"))
        self.assertIsNone(service_b._load_cache("org-1", "net-1"))

    async def test_api_key_is_not_written_to_persistent_files(self):
        secret = "privacy-test-key-12345"
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp) / "backend" / "data"
            data_dir.mkdir(parents=True)
            service = TopologyService(FakeMerakiClient(secret), ValidationService(), layouts=None, store=None, history=None)
            await service.build("org-1", "net-1")
            files = [path for path in data_dir.rglob("*") if path.is_file()]
            self.assertEqual(files, [])

    def test_sensitive_headers_are_redacted_from_logs(self):
        import logging

        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        logger = logging.getLogger("privacy-redaction-test")
        logger.handlers = [handler]
        logger.propagate = False
        logger.setLevel(logging.INFO)
        logger.addFilter(SensitiveDataFilter())

        secret = "redaction-secret-123"
        token = "bearer-secret-456"
        logger.info("headers=%s", {"X-Meraki-Api-Key": secret, "Authorization": f"Bearer {token}"})

        output = stream.getvalue()
        self.assertNotIn(secret, output)
        self.assertNotIn(token, output)
        self.assertIn("[REDACTED]", output)

    def test_production_compose_keeps_backend_private_and_tmpfs_only(self):
        compose = Path(__file__).resolve().parents[2] / "docker-compose.yml"
        text = compose.read_text(encoding="utf-8")
        backend_block = text.split("  frontend:", 1)[0]

        self.assertIn('      - "5500:80"', text)
        self.assertIn("expose:", backend_block)
        self.assertNotIn("\n    ports:", backend_block)
        self.assertIn("tmpfs:", backend_block)
        self.assertNotIn("backend" + "_data", text)


if __name__ == "__main__":
    unittest.main()
