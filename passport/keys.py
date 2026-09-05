"""
Generates an Ed25519 keypair for signing the merchant passport.

Run once:  python keys.py
Produces:
  - private_key.pem   (KEEP SERVER-SIDE, never expose, never commit to git)
  - public_key.pem    (this is what's referenced by the passport's
                        `integrity.public_key_url` field, published separately
                        e.g. at /.well-known/agent-commerce-key.json)
"""

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import os

KEY_DIR = os.path.dirname(os.path.abspath(__file__))
PRIVATE_KEY_PATH = os.path.join(KEY_DIR, "private_key.pem")
PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "public_key.pem")


def generate_keypair():
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    with open(PRIVATE_KEY_PATH, "wb") as f:
        f.write(private_bytes)
    with open(PUBLIC_KEY_PATH, "wb") as f:
        f.write(public_bytes)

    print(f"Private key written to {PRIVATE_KEY_PATH} (keep server-side only)")
    print(f"Public key written to {PUBLIC_KEY_PATH} (safe to publish)")


def load_private_key() -> Ed25519PrivateKey:
    if not os.path.exists(PRIVATE_KEY_PATH):
        raise FileNotFoundError(
            "No private key found. Run `python keys.py` first to generate one."
        )
    with open(PRIVATE_KEY_PATH, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def load_public_key():
    if not os.path.exists(PUBLIC_KEY_PATH):
        raise FileNotFoundError(
            "No public key found. Run `python keys.py` first to generate one."
        )
    with open(PUBLIC_KEY_PATH, "rb") as f:
        return serialization.load_pem_public_key(f.read())


if __name__ == "__main__":
    generate_keypair()
