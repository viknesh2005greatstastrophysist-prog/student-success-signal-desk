"""Create a private source delivery, excluding live credentials and database state."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import zipfile

os.umask(0o077)
root = Path(__file__).resolve().parents[1]
runtime = root / "runtime/project-final"
delivery = runtime / "delivery"
delivery.mkdir(mode=0o700, exist_ok=True)

browser = json.loads((runtime / "browser-acceptance.json").read_text())
assert browser["status"] == "passed", "Successful final browser acceptance required"
data = json.loads((runtime / "data-acceptance.json").read_text())
assert data["status"] == "passed", "Source integrity acceptance required"
assert json.loads((runtime / "platform-check-status.json").read_text())["exitCode"] == 0

names = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root,
).decode().split("\0")
source = []
for name in sorted(set(names) - {""}):
    path = Path(name)
    if any(part in {"runtime", "node_modules", ".next", ".git", ".venv", ".turbo"} for part in path.parts):
        continue
    if path.name.startswith(".env") and path.name != ".env.example":
        continue
    if (root / path).is_file():
        source.append(path)

inputs = root / "runtime/college-attendance/2026-10-12"
private = [inputs / name for name in [
    "attendance.json", "private-student-records.json", "source-context.json",
    "cie.json", "private-identity-map.json", "cie-source-context.json",
]] + sorted((inputs / "originals").glob("*.xls"))
assert len(private) == 12, "Six source inputs and six original workbooks required"
files = [(str(path), root / path, False) for path in source]
files += [(str(path.relative_to(root)), path, True) for path in private]

env = json.loads((runtime / "environment.json").read_text())
secrets = [env[key].encode() for key in ["BETTER_AUTH_SECRET", "PORTAL_SESSION_SECRET", "DATABASE_URL", "DATABASE_URL_UNPOOLED"]]
secrets += [account["password"].encode() for account in json.loads((runtime / "accounts.json").read_text())]
manifest = {"edition": "private six-portal project", "datasetHash": data["datasetHash"], "rawValues": data["rawValues"], "files": []}
archive = delivery / "AURA-complete-project.zip"
directories = set()
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    for relative, path, is_private in files:
        payload = path.read_bytes()
        assert all(secret not in payload for secret in secrets), f"Live credential found in {relative}"
        name = "aura-project/" + relative
        for parent in Path(name).parents:
            directory = str(parent) + "/"
            if directory == "./" or directory in directories:
                continue
            info = zipfile.ZipInfo(directory)
            info.external_attr = (0o40700 << 16) | 0x10
            package.writestr(info, b"")
            directories.add(directory)
        info = zipfile.ZipInfo(name)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o100600 if is_private else 0o100644) << 16
        package.writestr(info, payload)
        manifest["files"].append({"path": relative, "sha256": hashlib.sha256(payload).hexdigest(), "privateInput": is_private})
    source_rows = [row for row in manifest["files"] if not row["privateInput"]]
    manifest["sourceFingerprint"] = hashlib.sha256(json.dumps(source_rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    info = zipfile.ZipInfo("aura-project/DELIVERY_MANIFEST.json")
    info.external_attr = 0o100600 << 16
    package.writestr(info, json.dumps(manifest, indent=2) + "\n")
os.chmod(archive, 0o600)
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    archived = package.namelist()
    assert not any(name.endswith(("/environment.json", "/accounts.json", "/cohort.json")) or "/postgres/" in name for name in archived)
    assert not any(Path(name).name.startswith(".env") and Path(name).name != ".env.example" for name in archived)
result = {"archive": str(archive.relative_to(root)), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "sourceFingerprint": manifest["sourceFingerprint"], "sourceFiles": len(source), "privateInputs": len(private), "bytes": archive.stat().st_size, "liveCredentialsExcluded": True, "zipIntegrity": "passed"}
(delivery / "package-verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
