"""Fetch only the protocol's reserved public HMC nights, verifying publisher SHA-256 hashes."""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = "https://physionet.org/files/hmc-sleep-staging/1.1/"
DATA_BASE = "https://physionet-open.s3.amazonaws.com/hmc-sleep-staging/1.1/"


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def main():
    protocol = json.loads((ROOT / "prep/fixtures/state_realism_protocol.json").read_text())
    out = ROOT / "prep/realdata/hmc_holdout"
    out.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(BASE + "SHA256SUMS.txt", timeout=60) as response:
        checksums = {name.lstrip("*"): sha for sha, name in
                     (line.split(maxsplit=1) for line in response.read().decode().splitlines() if line.strip())}
    manifest = {"source": BASE, "protocol": protocol["protocol"], "files": {}}
    for subject in protocol["heldout_subjects"]:
        for suffix in [".edf", "_sleepscoring.edf"]:
            name = subject + suffix
            remote = "recordings/" + name
            expected = checksums[remote]
            path = out / name
            if not path.exists() or digest(path) != expected:
                print(f"Downloading {name}", flush=True)
                part = path.with_suffix(path.suffix + ".part")
                checksum = hashlib.sha256()
                with urllib.request.urlopen(DATA_BASE + remote, timeout=60) as response, part.open("wb") as file:
                    while block := response.read(1024 * 1024):
                        checksum.update(block)
                        file.write(block)
                if checksum.hexdigest() != expected:
                    raise RuntimeError(f"Publisher checksum mismatch for {name}; partial file retained")
                part.replace(path)
            manifest["files"][name] = {"sha256": expected, "bytes": path.stat().st_size}
            print(f"Verified {name}", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
