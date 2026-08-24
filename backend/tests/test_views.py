import unittest
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.view_service import ViewService
from app.storage.file_store import JsonFileStore


class ViewServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.svc = ViewService(JsonFileStore(tmp.name))

    def test_save_list_delete_view(self):
        saved = self.svc.save_view(
            "O1",
            "N1",
            {"name": "Server Infrastructure", "selected_nodes": ["MS", "SERVER"], "zoom": 1.2, "starred": True},
        )
        self.assertTrue(saved["shared"])
        self.assertEqual(saved["view_mode"], "physical_clients")
        listed = self.svc.list_views("O1", "N1")
        self.assertEqual(len(listed), 1)
        self.assertTrue(self.svc.delete_view("O1", "N1", saved["id"]))
        self.assertEqual(self.svc.list_views("O1", "N1"), [])

    def test_logical_groups(self):
        group = self.svc.save_group("O1", "N1", {"name": "Cameras", "member_ids": ["MS", "MV"]})
        self.assertEqual(group["member_ids"], ["MS", "MV"])
        self.assertEqual(len(self.svc.list_groups("O1", "N1")), 1)
        self.assertTrue(self.svc.delete_group("O1", "N1", group["id"]))
