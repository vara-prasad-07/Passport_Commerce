import { Card, CardHead, CopyButton, Empty, ErrorText, Icon, JsonBlock, Pill, Skeleton } from "../components/ui.jsx";
import { countdown, dateTime, formatMinor, humanize } from "../lib/format.js";
import { useTicker } from "../lib/hooks.js";

/** Live TTL ring. Mirrors the server's own freshness rule exactly:
 *  age = now - passport.version, stale once age > catalog.ttl_seconds. */
function TtlRing({ version, ttlSeconds }) {
  useTicker(1000, true);

  const issuedAt = version ? new Date(version).getTime() : null;
  const ttl = ttlSeconds ?? 0;
  const age = issuedAt ? (Date.now() - issuedAt) / 1000 : 0;
  const remaining = Math.max(0, ttl - age);
  const frac = ttl > 0 ? Math.max(0, Math.min(1, remaining / ttl)) : 0;

  const R = 26;
  const C = 2 * Math.PI * R;
  const state = remaining <= 0 ? "expired" : frac < 0.25 ? "low" : "";

  return (
    <div className={`ttl-ring ${state}`}>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle className="ttl-track" cx="32" cy="32" r={R} fill="none" strokeWidth="5" />
        <circle
          className="ttl-fill"
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <div className="ttl-meta">
        <div className="ttl-value">{remaining > 0 ? countdown(remaining) : "expired"}</div>
        <div className="dim xs">
          {remaining > 0 ? `until this passport goes stale (TTL ${ttl}s)` : "the server re-signs on the next read"}
        </div>
      </div>
    </div>
  );
}

function Attestation({ att }) {
  const thirdParty = att.issuer && att.issuer !== "merchant";
  return (
    <div className="cap">
      <span className="cap-name">{humanize(att.type)}</span>
      <div className="cap-flags">
        <span className={`tag ${thirdParty ? "emerald" : "amber"}`}>issuer: {att.issuer}</span>
        <span className="tag">{att.status}</span>
      </div>
      {att.issued_at && <span className="dim xs">issued {dateTime(att.issued_at)}</span>}
    </div>
  );
}

export default function Passport({ passport, loading, error, onRefresh }) {
  if (loading && !passport) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">Merchant passport</div>
          <h1 className="section-title">Verifying…</h1>
        </div>
        <Card className="card-pad">
          <Skeleton height={16} width="40%" />
          <Skeleton height={12} width="70%" style={{ marginTop: 12 }} />
          <Skeleton height={12} width="55%" style={{ marginTop: 8 }} />
        </Card>
      </div>
    );
  }

  if (!passport) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">Merchant passport</div>
          <h1 className="section-title">Passport unavailable</h1>
        </div>
        <Card className="card-pad">
          <Empty icon={<Icon.alert size={22} />}>
            The passport service could not be reached. Start it on <code className="code-inline">:8001</code> and try
            again.
          </Empty>
          <ErrorText>{error}</ErrorText>
          <button className="btn btn-block" onClick={onRefresh}>
            <Icon.refresh size={14} /> Retry
          </button>
        </Card>
      </div>
    );
  }

  const { merchant, bounds, policies, capabilities, catalog, attestations, integrity } = passport;

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Merchant passport</div>
        <h1 className="section-title">{merchant?.name}</h1>
        <p>
          Exactly what the merchant publishes at <code className="code-inline">/.well-known/agent-commerce.json</code>
          . The buyer agent fetches this over HTTP, verifies the Ed25519 signature and the freshness window itself,
          and refuses to transact if either check fails.
        </p>
      </div>

      {/* ---------------- verification ---------------- */}
      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <Card>
          <CardHead
            title="Verification"
            icon={<Icon.shieldCheck size={16} />}
            action={
              <button className="btn btn-sm" onClick={onRefresh} disabled={loading}>
                {loading ? <span className="spinner" /> : <Icon.refresh size={13} />} Re-verify
              </button>
            }
          />
          <div className="card-body">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <Pill tone={passport.signature_ok ? "ok" : "bad"}>
                {passport.signature_ok ? "Signature valid" : "Signature invalid"}
              </Pill>
              <Pill tone={passport.freshness_ok ? "ok" : "bad"}>
                {passport.freshness_ok ? "Fresh" : "Stale"}
              </Pill>
              <Pill tone={passport.trusted ? "ok" : "bad"}>
                {passport.trusted ? "Trusted" : "Not trusted"}
              </Pill>
            </div>

            <TtlRing version={passport.version} ttlSeconds={catalog?.ttl_seconds} />

            <hr className="divider" />

            <dl className="kv">
              <dt>Signature check</dt>
              <dd className={passport.signature_ok ? "text-emerald" : "text-rose"}>{passport.signature_reason}</dd>
              <dt>Freshness check</dt>
              <dd className={passport.freshness_ok ? "text-emerald" : "text-rose"}>{passport.freshness_reason}</dd>
            </dl>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Integrity block"
            icon={<Icon.lock size={16} />}
            sub="Everything a third party needs to re-verify this passport without trusting us."
          />
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {integrity ? (
              <>
                <div className="sig-field">
                  <span className="sig-label">Algorithm</span>
                  <span className="sig-value">{integrity.signature_algorithm}</span>
                </div>
                <div className="sig-field">
                  <span className="sig-label">Payload SHA-256</span>
                  <span className="sig-value">{integrity.payload_sha256}</span>
                </div>
                <div className="sig-field">
                  <span className="sig-label">Signature</span>
                  <span className="sig-value">{integrity.signature}</span>
                </div>
                <CopyButton value={JSON.stringify(integrity, null, 2)} label="Copy integrity block" />
              </>
            ) : (
              <Empty>No integrity block returned.</Empty>
            )}
          </div>
        </Card>
      </div>

      {/* ---------------- identity + bounds ---------------- */}
      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <Card>
          <CardHead title="Identity" icon={<Icon.store size={16} />} />
          <div className="card-body">
            <dl className="kv">
              <dt>Merchant</dt>
              <dd>{merchant?.name}</dd>
              <dt>Domain</dt>
              <dd>{merchant?.domain}</dd>
              <dt>Category</dt>
              <dd>{merchant?.category}</dd>
              <dt>Service regions</dt>
              <dd>{merchant?.service_regions?.join(", ")}</dd>
              <dt>Support</dt>
              <dd>{merchant?.support_channel}</dd>
              <dt>Passport ID</dt>
              <dd>{passport.passport_id}</dd>
              <dt>Schema</dt>
              <dd>{passport.schema ?? "agent-commerce/passport/v1"}</dd>
              <dt>Version</dt>
              <dd className="xs">{passport.version}</dd>
            </dl>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Financial bounds"
            icon={<Icon.scale size={16} />}
            sub="Declared here, but enforced by MarginMind from its own copy."
          />
          <div className="card-body">
            <dl className="kv">
              <dt>Max order value</dt>
              <dd>{formatMinor(bounds?.max_order_value_minor)}</dd>
              <dt>Discount ceiling</dt>
              <dd>{formatMinor(bounds?.discount_ceiling_minor)}</dd>
              <dt>Minimum margin</dt>
              <dd>{bounds?.min_margin_percent}%</dd>
              <dt>Allowed currencies</dt>
              <dd>{bounds?.allowed_currencies?.join(", ")}</dd>
              <dt>Rate limit / agent / hour</dt>
              <dd>
                {bounds?.rate_limit_per_agent_per_hour}{" "}
                <span className="tag amber" style={{ marginLeft: 6 }}>
                  declared, not enforced
                </span>
              </dd>
              <dt>Refund window</dt>
              <dd>{policies?.refund_window_days} days</dd>
              <dt>Cancellation</dt>
              <dd>before {policies?.cancellation_allowed_before}</dd>
              <dt>Support SLA</dt>
              <dd>{policies?.support_sla_hours}h</dd>
            </dl>
          </div>
        </Card>
      </div>

      {/* ---------------- capabilities ---------------- */}
      <Card style={{ marginBottom: 18 }}>
        <CardHead
          title="Capabilities"
          icon={<Icon.route size={16} />}
          sub="What this merchant permits an agent to do. Re-checked at confirm time, not just at discovery."
        />
        <div className="card-body">
          <div className="cap-grid">
            {Object.entries(capabilities ?? {}).map(([name, cap]) => (
              <div className="cap" key={name}>
                <span className="cap-name">{name}</span>
                <div className="cap-flags">
                  <span className={`tag ${cap.allowed ? "emerald" : "rose"}`}>
                    {cap.allowed ? "allowed" : "denied"}
                  </span>
                  {cap.requires_buyer_confirmation && <span className="tag gold">buyer consent</span>}
                  {cap.requires_merchant_approval && <span className="tag amber">merchant approval</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ---------------- attestations ---------------- */}
      <Card style={{ marginBottom: 18 }}>
        <CardHead
          title="Attestations"
          icon={<Icon.file size={16} />}
          sub="Each carries an issuer, so an agent can distinguish a merchant self-declaration from a third-party proof."
        />
        <div className="card-body">
          {attestations?.length ? (
            <div className="cap-grid">
              {attestations.map((a) => (
                <Attestation att={a} key={a.type} />
              ))}
            </div>
          ) : (
            <Empty>No attestations published.</Empty>
          )}
        </div>
      </Card>

      {/* ---------------- catalog ---------------- */}
      <Card style={{ marginBottom: 18 }}>
        <CardHead
          title="Catalog"
          icon={<Icon.store size={16} />}
          sub="Note what is absent: no cost and no margin data is published here. MarginMind reads those privately."
          action={
            <span className="tag">
              {catalog?.items?.length ?? 0} SKUs · TTL {catalog?.ttl_seconds}s
            </span>
          }
        />
        <div className="card-body">
          <div className="table-scroll">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Stock</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {catalog?.items?.map((item) => (
                  <tr key={item.sku}>
                    <td>
                      <div className="catalog-name">{item.name}</div>
                      <div className="dim xs mono">{item.sku}</div>
                      <div className="catalog-tags">
                        {item.tags?.map((t) => (
                          <span className="chip" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`tag ${item.stock === "low_stock" ? "amber" : "emerald"}`}>
                        {humanize(item.stock)}
                      </span>
                    </td>
                    <td className="price">{formatMinor(item.price_minor, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* ---------------- raw ---------------- */}
      <Card>
        <CardHead
          title="Raw verified response"
          icon={<Icon.file size={16} />}
          sub="The exact payload the buyer agent verified, as returned by /api/passport/summary."
          action={<CopyButton value={JSON.stringify(passport, null, 2)} label="Copy JSON" />}
        />
        <div className="card-body">
          <JsonBlock value={passport} maxHeight={420} />
        </div>
      </Card>
    </div>
  );
}
