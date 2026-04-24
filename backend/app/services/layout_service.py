from app.storage.file_store import JsonFileStore


class LayoutService:
    def __init__(self, store: JsonFileStore) -> None:
        self.store = store

    def _key(self, org_id: str, network_id: str) -> str:
        return f"layout_{org_id}_{network_id}.json"

    def save_positions(self, org_id: str, network_id: str, positions: dict[str, dict[str, float]]) -> None:
        self.store.write_json(self._key(org_id, network_id), positions)

    def get_positions(self, org_id: str, network_id: str) -> dict[str, dict[str, float]]:
        return self.store.read_json(self._key(org_id, network_id), {})
