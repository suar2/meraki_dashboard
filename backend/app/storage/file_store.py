import json
from pathlib import Path
from typing import Any


class JsonFileStore:
    def __init__(self, data_dir: str) -> None:
        self.base = Path(data_dir)
        self.base.mkdir(parents=True, exist_ok=True)
        test_file = self.base / ".write_test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink(missing_ok=True)

    def read_json(self, name: str, default: Any) -> Any:
        path = self.base / name
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as fp:
            return json.load(fp)

    def write_json(self, name: str, payload: Any) -> None:
        path = self.base / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fp:
            json.dump(payload, fp, indent=2, default=str)
