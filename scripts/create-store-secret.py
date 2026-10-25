#!/usr/bin/env python3
"""Create credentials once, outside the repo, and apply a Kubernetes Secret via stdin."""
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess

namespace = "urumi"
config = Path.home() / ".config/urumi/store-credentials.json"
config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
if not config.exists():
    values = {key: secrets.token_urlsafe(32) for key in (
        "database-password", "database-root-password", "admin-password"
    )}
    descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(values, stream)
else:
    values = json.loads(config.read_text())
os.chmod(config, 0o600)
subprocess.run(["kubectl", "create", "namespace", namespace], check=False,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
secret = {"apiVersion": "v1", "kind": "Secret", "metadata": {
    "name": "urumi-store-credentials", "namespace": namespace
}, "type": "Opaque", "data": {
    key: base64.b64encode(value.encode()).decode() for key, value in values.items()
}}
subprocess.run(["kubectl", "apply", "-f", "-"], input=json.dumps(secret),
               text=True, check=True)
print(f"Credentials retained privately in {config}; values were not printed.")
