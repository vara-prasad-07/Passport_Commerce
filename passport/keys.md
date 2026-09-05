# keys.py: Create and Load Keys

`keys.py` manages the Ed25519 key pair used by the Merchant Passport.

## Step 1: Generate the key pair

Run this once from the `passport` directory:

```bash
python keys.py
```

The script creates two files beside `keys.py`:

| File | Purpose | Handling |
| --- | --- | --- |
| `private_key.pem` | Signs passports | Keep server-side and secret |
| `public_key.pem` | Verifies passport signatures | Safe to publish |

`generate_keypair()` creates the private Ed25519 key, derives its matching
public key, serializes both as PEM, and writes both files.

## Step 2: Load a key from another module

`load_private_key()` is used by `generator.py` to sign a passport. It raises a
clear error if the private key has not been generated yet.

`load_public_key()` is used by a buyer or verifier to check the signature. The
buyer only needs the public key; it must never receive `private_key.pem`.

## Workflow handoff

After this file has generated the keys, run `generator.py`. It uses
`private_key.pem` to sign the merchant passport. Later, `server.py` publishes
`public_key.pem` so buyers can verify that passport.