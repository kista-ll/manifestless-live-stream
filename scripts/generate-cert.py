from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "server" / "src"))

from manifestless_server.certs import ensure_localhost_cert


def main() -> None:
    cert_path = Path(os.environ.get("CERT_PATH", ROOT / "certs" / "localhost.crt"))
    key_path = Path(os.environ.get("KEY_PATH", ROOT / "certs" / "localhost.key"))
    cert_hash = ensure_localhost_cert(cert_path, key_path)
    print(f"Generated {cert_path} and {key_path}")
    print("Certificate: ECDSA P-256 self-signed localhost certificate")
    print(f"serverCertificateHashes sha-256: {cert_hash}")


if __name__ == "__main__":
    main()
