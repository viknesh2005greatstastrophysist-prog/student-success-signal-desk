"""Private server-to-worker bridge; browser widgets never supply trusted actors."""

from __future__ import annotations

import atexit
import hashlib
import json
import os
import platform
import select
import shutil
import subprocess
import tarfile
import tempfile
import threading
import urllib.request
import uuid
from contextlib import ExitStack
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent


class BridgeError(RuntimeError):
    def __init__(
        self,
        message: str,
        code: str = "REQUEST_FAILED",
        status: int = 500,
        retry_after: int | None = None,
    ):
        super().__init__(message)
        self.code, self.status, self.retry_after = code, status, retry_after


# Seconds the bridge waits for the engine. A review may wait for a whole AI quota
# window several times (each call up to about 70 s), so running one gets longer.
REQUEST_SECONDS = 180
LONG_REQUEST_SECONDS = {"plan_execute": 420}


MODEL_ADAPTER_KEYS = frozenset({"GROQ_API_KEY", "CH11_MODEL_API_KEY"})


def read_environment_file(path: Path) -> dict[str, str]:
    if path.suffix == ".json":
        return json.loads(path.read_text())
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.replace("_", "").isalnum():
            raise BridgeError(
                "Invalid private environment file assignment.", "SETUP_REQUIRED"
            )
        value = value.strip()
        values[key] = json.loads(value) if value.startswith('"') else value.strip("'")
    return values


def environment() -> dict[str, str]:
    """Cloud secrets are explicit; never silently use local settings in cloud mode."""
    try:
        section = dict(st.secrets.get("aura", {}))
    except st.errors.StreamlitSecretNotFoundError:
        section = {}
    config_file = os.environ.get("AURA_STREAMLIT_ENV_FILE")
    if section:
        values = section
    elif config_file:
        values = read_environment_file(Path(config_file))
    elif (REPO / ".env").is_file():
        values = read_environment_file(REPO / ".env")
    elif (REPO / "runtime/project-final/environment.json").is_file():
        values = json.loads(
            (REPO / "runtime/project-final/environment.json").read_text()
        )
    else:
        raise BridgeError(
            "Configure the private AURA runtime before signing in.", "SETUP_REQUIRED"
        )
    # Credential-vault entries (AURA_LOGIN_*, AURA_CLOUD_*) never reach the
    # worker. Model-adapter keys are allowlisted explicitly; the worker moves
    # them into the provider module and removes them from its environment.
    values = {
        key: value
        for key, value in values.items()
        if key in MODEL_ADAPTER_KEYS
        or not key.startswith(("AURA_LOGIN_", "AURA_CLOUD_"))
    }
    if values.get("CORE_IDENTITY_REALM") not in {"project", "college-project"}:
        raise BridgeError(
            "The app requires a dedicated college project runtime.", "SETUP_REQUIRED"
        )
    worker_environment = {
        **os.environ,
        **{key: str(value) for key, value in values.items()},
        "NODE_ENV": "production",
    }
    return {
        key: value
        for key, value in worker_environment.items()
        if not key.startswith(("AURA_LOGIN_", "AURA_CLOUD_"))
    }


def node_binary() -> str:
    configured = os.environ.get("AURA_NODE_BINARY") or shutil.which("node")
    if configured:
        check = subprocess.run(
            [configured, "--version"], capture_output=True, text=True, check=True
        )
        if int(check.stdout.strip().lstrip("v").split(".")[0]) >= 22:
            return configured
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "aarch64"}:
        raise BridgeError(
            "Install Node.js22 or newer to start the college engine.", "SETUP_REQUIRED"
        )
    # CommunityCloud supplies Python; fetch the same pinned official Node runtime
    # without installing or activating any paid service. Verify vendor checksum.
    version, arch = (
        "v22.23.2",
        {"x86_64": "x64", "aarch64": "arm64"}[platform.machine()],
    )
    name = f"node-{version}-linux-{arch}"
    cache = Path(tempfile.gettempdir()) / "aura-node-runtime"
    binary = cache / name / "bin/node"
    if binary.exists():
        return str(binary)
    cache.mkdir(mode=0o700, exist_ok=True)
    archive = cache / f"{name}.tar.gz"
    base = f"https://nodejs.org/dist/{version}/"
    checksums = (
        urllib.request.urlopen(base + "SHASUMS256.txt", timeout=30).read().decode()
    )
    expected = next(
        line.split()[0]
        for line in checksums.splitlines()
        if line.split()[-1] == archive.name
    )
    with urllib.request.urlopen(base + archive.name, timeout=60) as response:
        archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        archive.unlink(missing_ok=True)
        raise BridgeError(
            "The official Node runtime checksum did not match.", "SETUP_REQUIRED"
        )
    with tarfile.open(archive) as package:
        package.extractall(cache, filter="data")
    archive.unlink()
    return str(binary)


class Client:
    def __init__(self):
        self._lock = threading.Lock()
        self._env = environment()
        self._node = node_binary()
        self._process: subprocess.Popen | None = None
        self._resources = ExitStack()
        self._log = self._resources.enter_context(tempfile.TemporaryFile(mode="w+b"))  # noqa: SIM115 -- transport lifetime ends in close()
        self._start()
        atexit.register(self.close)

    def _start(self):
        self._process = subprocess.Popen(
            [self._node, str(ROOT / "engine.mjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._log,
            text=True,
            bufsize=1,
            env=self._env,
            cwd=ROOT,
        )

    def request(
        self, action: str, data: dict | None = None, token: str | None = None
    ) -> object:
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                self._start()
            request = {"id": str(uuid.uuid4()), "action": action, "payload": data or {}}
            if token:
                request["token"] = token
            try:
                self._process.stdin.write(
                    json.dumps(request, separators=(",", ":")) + "\n"
                )
                self._process.stdin.flush()
                ready, _, _ = select.select(
                    [self._process.stdout],
                    [],
                    [],
                    LONG_REQUEST_SECONDS.get(action, REQUEST_SECONDS),
                )
                if not ready:
                    self._process.terminate()
                    raise BridgeError(
                        "The action timed out. Refresh its state before retrying.",
                        "REQUEST_TIMEOUT",
                    )
                line = self._process.stdout.readline()
                if not line:
                    raise BridgeError(
                        "The college engine stopped. Check its private runtime configuration.",
                        "ENGINE_STOPPED",
                    )
                response = json.loads(line)
                if response.get("id") != request["id"]:
                    raise BridgeError(
                        "Unexpected college engine response.", "ENGINE_PROTOCOL"
                    )
                if not response.get("ok"):
                    error = response["error"]
                    raise BridgeError(
                        error["message"],
                        error.get("code", "REQUEST_FAILED"),
                        error.get("status", 500),
                        error.get("retryAfterSeconds"),
                    )
                return response["data"]
            except (BrokenPipeError, OSError, json.JSONDecodeError) as error:
                raise BridgeError(
                    "The college engine connection failed. Refresh and retry.",
                    "ENGINE_STOPPED",
                ) from error

    def login(self, email: str, password: str, portal: str) -> dict:
        source = st.context.ip_address
        if not isinstance(source, str) or not source:
            source = "server-local"
        return self.request(
            "login",
            {"email": email, "password": password, "portal": portal, "source": source},
        )

    def logout(self, token: str):
        return self.request("logout", token=token)

    def close(self):
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
        self._resources.close()


@st.cache_resource(show_spinner="Connecting to the college workspace…")
def get_client() -> Client:
    # Only the transport is shared. Sessions and returned data remain user scoped.
    return Client()
