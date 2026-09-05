# verify.py: Verify a Merchant Passport

`verify.py` performs the two checks a buyer should complete before trusting a
passport or calling MarginMind:

1. Is the passport authentic and unchanged?
2. Is the passport still fresh?

## Step 1: Load the passport and public key

The verifier needs the JSON served by `server.py` and the matching public key.
For a local self-test, run this from the `passport` directory:

```bash
python verify.py
```

The self-test loads `passport.json`, loads `public_key.pem` through
`keys.py`, and runs both checks.

## Step 2: Check the signature

```python
verify_signature(passport, public_key)
```

This function:

1. Copies the passport and removes its `integrity` block.
2. Recreates the canonical JSON bytes.
3. Recalculates the SHA-256 payload hash.
4. Compares that hash with `integrity.payload_sha256`.
5. Verifies the Ed25519 signature using the public key.

Changing a signed field, such as an item price, causes this check to fail.
The result is a `VerificationResult` with `ok` and a human-readable `reason`.

## Step 3: Check freshness

```python
verify_freshness(passport)
```

This function reads the passport's `version` timestamp and
`catalog.ttl_seconds`. It calculates the passport age using the current UTC
time. The check passes while:

```text
age_seconds <= ttl_seconds
```

Missing fields or an expired TTL produce a failed result.

## Step 4: Run both checks

```python
signature_result, freshness_result = verify_passport(passport, public_key)

if signature_result.ok and freshness_result.ok:
	# The buyer may continue to the next operation.
	pass
else:
	# Reject the passport and do not trust its merchant data.
	pass
```

Both results must be successful. A valid signature does not make an expired
passport trustworthy, and a fresh passport is not trustworthy if its contents
were tampered with.

The standalone self-test also changes the first catalog item's price in a
copy and confirms that signature verification rejects the tampered copy.
