# generator.py: Build and Sign the Passport

`generator.py` converts `merchant_data.json` into a signed `passport.json`.
Run it from the `passport` directory:

```bash
python generator.py
```

## Step 1: Read merchant data

The script reads `merchant_data.json`. The input provides the merchant,
catalog, policies, capabilities, bounds, attestations, and passport TTL.

## Step 2: Build the unsigned passport

`build_passport()` creates the fields a buyer needs, including:

- schema and passport ID
- current UTC `version` timestamp
- merchant and catalog information
- policies, capabilities, and transaction bounds
- attestations with the current `issued_at` timestamp
- catalog `ttl_seconds`

At this point the passport does not contain an `integrity` block.

## Step 3: Create deterministic bytes

`canonical_bytes()` serializes the unsigned passport as JSON with sorted keys
and no extra whitespace. This gives the signer and verifier exactly the same
bytes, even if the regular JSON formatting differs.

## Step 4: Hash and sign

The script calculates a SHA-256 hash of the canonical bytes, then loads
`private_key.pem` through `keys.py` and creates an Ed25519 signature.

The final `integrity` block stores:

```json
{
   "signature_algorithm": "Ed25519",
   "public_key_url": "https://merchant.example/.well-known/agent-commerce-key.json",
   "payload_sha256": "...",
   "signature": "..."
}
```

The integrity block is excluded from the signed payload because it contains
the signature itself.

## Step 5: Write the output

`write_passport()` writes the signed result to `passport.json`. This is the
file that `server.py` serves.

Regenerate it after changing `merchant_data.json`:

```bash
python generator.py
```

The next step is to run `server.py`, which makes the passport and public key
available over HTTP.
