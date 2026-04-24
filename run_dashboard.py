from __future__ import annotations

import argparse
import importlib.util
import json
import os
import signal
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
STATE_FILE = ROOT / ".run_dashboard_state.json"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def write_state(data: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def read_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def start_services() -> None:
    env_file = load_env(ENV_PATH)
    merged_env = os.environ.copy()
    merged_env.update(env_file)

    backend_port = int(env_file.get("BACKEND_PORT", "8000"))
    frontend_port = int(env_file.get("FRONTEND_PORT", "3000"))

    npm_cmd = resolve_npm_command()
    if not npm_cmd:
        print("Could not find npm on PATH.")
        print("Install Node.js (includes npm), then restart your terminal and run again.")
        print("Download: https://nodejs.org/")
        return

    node_cmd = resolve_node_command()
    if not node_cmd:
        print("Could not find node executable.")
        print("Install Node.js and retry.")
        return
    merged_env = with_node_on_path(merged_env, node_cmd)

    if not ensure_backend_dependencies():
        return
    if not ensure_frontend_dependencies(npm_cmd, merged_env):
        return

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        str(backend_port),
        "--reload",
    ]
    vite_entry = _vite_entry(ROOT / "frontend" / "node_modules")
    if str(vite_entry).endswith(".js"):
        frontend_cmd = [node_cmd, str(vite_entry), "--host", "0.0.0.0", "--port", str(frontend_port)]
    else:
        frontend_cmd = [npm_cmd, "run", "dev", "--", "--host", "0.0.0.0", "--port", str(frontend_port)]

    creation_flags = 0
    if os.name == "nt":
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]

    try:
        backend_proc = subprocess.Popen(
            backend_cmd,
            cwd=str(ROOT / "backend"),
            env=merged_env,
            creationflags=creation_flags,
        )
    except FileNotFoundError:
        print("Could not start backend: uvicorn module is missing.")
        print("Run: pip install -r backend/requirements.txt")
        return

    try:
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=str(ROOT / "frontend"),
            env=merged_env,
            creationflags=creation_flags,
        )
    except FileNotFoundError:
        try:
            os.kill(backend_proc.pid, signal.SIGTERM)
        except OSError:
            pass
        print("Could not start frontend process.")
        print("Install Node.js (npm) and ensure it is available in PATH.")
        return

    state = {
        "backend_pid": backend_proc.pid,
        "frontend_pid": frontend_proc.pid,
        "backend_port": backend_port,
        "frontend_port": frontend_port,
    }
    write_state(state)

    print(f"Backend  PID {backend_proc.pid} → http://localhost:{backend_port}")
    print(f"Frontend PID {frontend_proc.pid} → http://localhost:{frontend_port}")
    print("Use: python run_dashboard.py status / stop")


def ensure_backend_dependencies() -> bool:
    if importlib.util.find_spec("uvicorn") is not None:
        return True
    print("Backend dependencies missing. Installing from backend/requirements.txt ...")
    cmd = [
        sys.executable, "-m", "pip", "install",
        "--break-system-packages",
        "-r", str(ROOT / "backend" / "requirements.txt"),
    ]
    result = subprocess.run(cmd, cwd=str(ROOT), check=False)
    if result.returncode != 0:
        print("Failed to install backend dependencies.")
        return False
    return importlib.util.find_spec("uvicorn") is not None


def _vite_entry(node_modules: Path) -> Path:
    """Return the vite entry point, preferring the .bin symlink but falling back to the JS file."""
    bin_symlink = node_modules / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    if bin_symlink.exists():
        return bin_symlink
    return node_modules / "vite" / "bin" / "vite.js"


def ensure_frontend_dependencies(npm_cmd: str, env: dict[str, str]) -> bool:
    node_modules = ROOT / "frontend" / "node_modules"
    vite_pkg = node_modules / "vite" / "bin" / "vite.js"
    if node_modules.exists() and vite_pkg.exists():
        return True
    print("Frontend dependencies missing. Running npm install ...")
    result = subprocess.run([npm_cmd, "install"], cwd=str(ROOT / "frontend"), env=env, check=False)
    if result.returncode != 0 and os.name == "nt":
        result = subprocess.run(
            [npm_cmd, "install", "--no-audit", "--no-fund", "--no-package-lock"],
            cwd=str(ROOT / "frontend"),
            env=env,
            check=False,
        )
    if result.returncode != 0:
        print("Failed to install frontend dependencies.")
        return False
    return vite_pkg.exists()


def resolve_npm_command() -> str | None:
    candidates = ["npm.cmd", "npm", "npx.cmd", "npx"] if os.name == "nt" else ["npm", "npx"]
    for candidate in candidates:
        if shutil.which(candidate):
            return candidate
    if os.name == "nt":
        common_paths = [
            Path("C:/Program Files/nodejs/npm.cmd"),
            Path("C:/Program Files/nodejs/npx.cmd"),
            Path("C:/Program Files (x86)/nodejs/npm.cmd"),
            Path("C:/Program Files (x86)/nodejs/npx.cmd"),
        ]
        for path in common_paths:
            if path.exists():
                return str(path)
    return None


def resolve_node_command() -> str | None:
    candidates = ["node.exe", "node"] if os.name == "nt" else ["node"]
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    if os.name == "nt":
        common_paths = [
            Path("C:/Program Files/nodejs/node.exe"),
            Path("C:/Program Files (x86)/nodejs/node.exe"),
        ]
        for path in common_paths:
            if path.exists():
                return str(path)
    return None


def with_node_on_path(env: dict[str, str], node_cmd: str) -> dict[str, str]:
    updated = dict(env)
    node_dir = str(Path(node_cmd).resolve().parent)
    current_path = updated.get("PATH", "")
    if node_dir.lower() not in current_path.lower():
        updated["PATH"] = f"{node_dir}{os.pathsep}{current_path}" if current_path else node_dir
    return updated


def stop_services() -> None:
    state = read_state()
    if not state:
        print("No running state file found.")
        return

    for key in ("backend_pid", "frontend_pid"):
        pid = state.get(key)
        if not isinstance(pid, int):
            continue
        if not is_running(pid):
            print(f"{key}: PID {pid} is not running.")
            continue
        try:
            if os.name == "nt":
                os.kill(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
            print(f"Stopped {key} PID {pid}.")
        except OSError as exc:
            print(f"Failed to stop {key} PID {pid}: {exc}")

    try:
        STATE_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def status_services() -> None:
    state = read_state()
    if not state:
        print("No running state file found.")
        return
    for key in ("backend_pid", "frontend_pid"):
        pid = state.get(key)
        if not isinstance(pid, int):
            print(f"{key}: unknown")
            continue
        print(f"{key}: PID {pid} ({'running' if is_running(pid) else 'stopped'})")
    print(f"Backend URL:  http://localhost:{state.get('backend_port', 8000)}")
    print(f"Frontend URL: http://localhost:{state.get('frontend_port', 3000)}")
    print(f"Backend log:  {state.get('backend_log', '-')}")
    print(f"Frontend log: {state.get('frontend_log', '-')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Start/stop/status for Meraki dashboard services.")
    parser.add_argument("command", choices=["start", "stop", "status"], nargs="?", default="start")
    args = parser.parse_args()

    if args.command == "start":
        start_services()
    elif args.command == "stop":
        stop_services()
    else:
        status_services()


if __name__ == "__main__":
    main()
