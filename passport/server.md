# server.py: Serve the Merchant Passport

`server.py` exposes the signed passport and its public verification key through
a small FastAPI application.

## Step 1: Start the server

From the `passport` directory, run:

```bash
uvicorn server:app --reload --port 8001
```

The correct module is `server:app`. Running `uvicorn main:app` starts a
different application, if one exists, and does not start this passport
server.

At startup, `ensure_passport_exists()` creates `passport.json` by calling
`generator.write_passport()` if the file does not exist. The key pair must
already exist for this automatic generation to work.

## Step 2: Fetch the signed passport

```text
GET /.well-known/agent-commerce.json
```

Example:

```bash
curl http://localhost:8001/.well-known/agent-commerce.json
```

The endpoint reads and returns `passport.json` as JSON.

## Step 3: Fetch the public key

```text
GET /.well-known/agent-commerce-key.json
```

Example:

```bash
curl http://localhost:8001/.well-known/agent-commerce-key.json
```

The response contains the key ID, algorithm, and PEM-encoded public key. A
buyer uses this public key with `verify.py`; the private key is never served.

## Step 4: Regenerate after merchant changes

```text
POST /admin/regenerate
```

This calls `write_passport()` and replaces `passport.json` with a newly signed
version. Use it after editing `merchant_data.json`.

## End-to-end handoff

The buyer downloads both well-known resources, verifies the passport's
signature, checks its freshness, and only then trusts the merchant data.
