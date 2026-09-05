"""
Merchant namespacing for the passport service.

One merchant, deeply implemented, was the right MVP call — but "one merchant"
and "hard-coded to one merchant" are different things, and only the first is a
product. Every path a passport needs (its source data, its signing keypair,
its published document) is resolved through this module by merchant id, so
adding a merchant is a data change: drop in a `merchant_data.<id>.json`, and
its passport is generated, signed with its OWN keypair, and served at its own
namespaced well-known URL.

Separate keypairs per merchant are not decoration. A registry where every
passport is signed by one key is a registry with one trust anchor and no
meaningful notion of a merchant being compromised; the whole point of the
buyer verifying a signature is that it identifies *that merchant*.

The default merchant keeps the original unsuffixed filenames and the
unnamespaced well-known URL, because that is genuinely what a merchant
publishes on their own domain — the namespaced form is the registry's view of
the same document.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PASSPORT_DIR = Path(__file__).resolve().parent
KEYS_DIR = PASSPORT_DIR / "keys"

DEFAULT_MERCHANT_ID = os.getenv("DEFAULT_MERCHANT_ID", "greenbowl")

# Merchant ids land in filesystem paths and URLs, so they are constrained
# rather than sanitised — a rejected id is safer than a cleverly rewritten one.
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class UnknownMerchant(Exception):
    pass


def validate_id(merchant_id: str) -> str:
    if not _ID_RE.match(merchant_id or ""):
        raise UnknownMerchant(f"invalid merchant id: {merchant_id!r}")
    return merchant_id


def data_path(merchant_id: str) -> Path:
    validate_id(merchant_id)
    if merchant_id == DEFAULT_MERCHANT_ID:
        return PASSPORT_DIR / "merchant_data.json"
    return PASSPORT_DIR / f"merchant_data.{merchant_id}.json"


def passport_path(merchant_id: str) -> Path:
    validate_id(merchant_id)
    if merchant_id == DEFAULT_MERCHANT_ID:
        return PASSPORT_DIR / "passport.json"
    return PASSPORT_DIR / f"passport.{merchant_id}.json"


def key_paths(merchant_id: str) -> tuple[Path, Path]:
    validate_id(merchant_id)
    if merchant_id == DEFAULT_MERCHANT_ID:
        return PASSPORT_DIR / "private_key.pem", PASSPORT_DIR / "public_key.pem"
    return KEYS_DIR / f"{merchant_id}_private.pem", KEYS_DIR / f"{merchant_id}_public.pem"


def key_id(merchant_id: str) -> str:
    return f"{merchant_id}-key-1"


def exists(merchant_id: str) -> bool:
    try:
        return data_path(merchant_id).exists()
    except UnknownMerchant:
        return False


def list_merchants() -> list[dict]:
    """Every merchant with source data on disk, default first."""
    found: list[dict] = []
    for path in sorted(PASSPORT_DIR.glob("merchant_data*.json")):
        name = path.name
        if name == "merchant_data.json":
            merchant_id = DEFAULT_MERCHANT_ID
        else:
            merchant_id = name[len("merchant_data.") : -len(".json")]
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        merchant = data.get("merchant", {})
        found.append(
            {
                "merchant_id": merchant_id,
                "name": merchant.get("name", merchant_id),
                "domain": merchant.get("domain"),
                "category": merchant.get("category"),
                "service_regions": merchant.get("service_regions", []),
                "catalog_size": len(data.get("catalog", {}).get("items", [])),
                "is_default": merchant_id == DEFAULT_MERCHANT_ID,
            }
        )
    found.sort(key=lambda m: (not m["is_default"], m["merchant_id"]))
    return found


def load_data(merchant_id: str) -> dict:
    path = data_path(merchant_id)
    if not path.exists():
        raise UnknownMerchant(f"no merchant data for {merchant_id!r}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(merchant_id: str, data: dict) -> None:
    path = data_path(merchant_id)
    if not path.exists():
        raise UnknownMerchant(f"no merchant data for {merchant_id!r}")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def ensure_keypair(merchant_id: str) -> tuple[Path, Path]:
    """Generate this merchant's keypair on first use.

    Generating lazily keeps adding a merchant to a single file drop, and a
    keypair that has never signed anything is worth exactly nothing, so there
    is no security cost to creating it on demand.
    """
    private_path, public_path = key_paths(merchant_id)
    if private_path.exists() and public_path.exists():
        return private_path, public_path

    private_path.parent.mkdir(parents=True, exist_ok=True)
    private_key = Ed25519PrivateKey.generate()
    private_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    public_path.write_bytes(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return private_path, public_path


def load_private_key(merchant_id: str) -> Ed25519PrivateKey:
    private_path, _ = ensure_keypair(merchant_id)
    return serialization.load_pem_private_key(private_path.read_bytes(), password=None)


def load_public_key_pem(merchant_id: str) -> str:
    _, public_path = ensure_keypair(merchant_id)
    return public_path.read_text(encoding="utf-8")
