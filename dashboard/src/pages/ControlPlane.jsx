import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { dateTime, formatMinor, relativeTime, truncateMiddle } from "../lib/format.js";
import { Card, CardHead, CopyButton, ErrorText, Icon, JsonBlock, RangeSlider, Skeleton } from "../components/ui.jsx";

/*
 * The merchant's own console.
 *
 * This page is the difference between "we generated a signed JSON file" and
 * "a merchant operates this". Change a bound here and three things happen in
 * one round trip, all visible: the merchant's configuration is written, a NEW
 * passport is signed with a new version and a genuinely different signature,
 * and MarginMind — which re-reads that same file on every decision — starts
 * enforcing the new number on the very next buyer query.
 *
 * It talks to the passport service (:8001) directly rather than through the
 * buyer agent. That is not a shortcut; routing a merchant's catalog edits
 * through the buyer's agent would contradict the separation the whole project
 * argues for.
 */

const BOUND_FIELDS = [
  {
    key: "max_order_value_minor",
    label: "Autonomous order cap",
    help: "The most an agent may spend in one order without human escalation.",
    money: true,
    min: 10000,
    max: 1000000,
    step: 10000,
  },
  {
    key: "discount_ceiling_minor",
    label: "Discount ceiling",
    help: "The most MarginMind may ever discount a basket by.",
    money: true,
    min: 0,
    max: 50000,
    step: 2500,
  },
  {
    key: "min_margin_percent",
    label: "Margin floor",
    help: "No basket may be sold below this margin. Raise it and watch options disappear.",
    money: false,
    suffix: "%",
    min: 0,
    max: 70,
    step: 1,
  },
];

function SignatureCard({ passport, lastChange, busy }) {
  if (!passport) return <Skeleton height={180} />;
  return (
    <Card className="cp-sig">
      <CardHead
        title="Published passport"
        sub="What every buyer agent fetches and verifies"
        icon={<Icon.shieldCheck size={15} />}
        action={busy ? <span className="spinner" /> : null}
      />
      <dl className="cp-sig-list">
        <div className="cp-sig-row">
          <dt>Version</dt>
          <dd>
            {dateTime(passport.version)} <span className="dim xs">· {relativeTime(passport.version)}</span>
          </dd>
        </div>
        <div className="cp-sig-row">
          <dt>Key</dt>
          <dd className="mono">{passport.key_id}</dd>
        </div>
        <div className="cp-sig-row is-hash">
          <dt>Payload SHA-256</dt>
          <dd className="mono">{passport.payload_sha256}</dd>
        </div>
        <div className="cp-sig-row is-hash">
          <dt>
            Signature
            <CopyButton value={passport.signature} label="Copy" />
          </dt>
          <dd className="mono">{truncateMiddle(passport.signature, 22, 18)}</dd>
        </div>
      </dl>

      {lastChange && (
        <div className="cp-change rise">
          <div className="cp-change-head">
            <Icon.refresh size={13} />
            Re-signed · {lastChange.changed.length} field{lastChange.changed.length === 1 ? "" : "s"} changed
          </div>
          <ul className="cp-change-fields">
            {lastChange.changed.map((f) => (
              <li key={f}>
                <code className="code-inline">{f}</code>
              </li>
            ))}
          </ul>
          <div className="cp-sig-diff">
            <div>
              <span className="dim xs">before</span>
              <code className="mono is-old">{truncateMiddle(lastChange.before.signature, 10, 8)}</code>
            </div>
            <Icon.arrowRight size={13} />
            <div>
              <span className="dim xs">after</span>
              <code className="mono is-new">{truncateMiddle(lastChange.after.signature, 10, 8)}</code>
            </div>
          </div>
          <p className="cp-change-note">
            {lastChange.signature_changed
              ? "A different document, signed with the merchant's key. Any cached copy of the old one now fails verification."
              : "The signature did not change — nothing in the signed payload actually differed."}
          </p>
        </div>
      )}
    </Card>
  );
}

export default function ControlPlane({ onChanged }) {
  const [merchantId, setMerchantId] = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [data, setData] = useState(null);
  const [passport, setPassport] = useState(null);
  const [draft, setDraft] = useState(null);
  const [catalogDraft, setCatalogDraft] = useState({});
  const [lastChange, setLastChange] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async (id) => {
    setError(null);
    try {
      const listing = await api.merchants();
      setMerchants(listing.merchants);
      const target = id ?? listing.default ?? listing.merchants[0]?.merchant_id;
      setMerchantId(target);
      const detail = await api.merchant(target);
      setData(detail.data);
      setPassport(detail.passport);
      setDraft({ ...detail.data.bounds, ttl_seconds: detail.data.ttl_seconds });
      setCatalogDraft({});
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    const boundsChanged = Object.entries(draft).some(([k, v]) =>
      k === "ttl_seconds" ? v !== data.ttl_seconds : v !== data.bounds[k]
    );
    return boundsChanged || Object.keys(catalogDraft).length > 0;
  }, [data, draft, catalogDraft]);

  async function publish() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { ttl_seconds, ...bounds } = draft;
      const result = await api.patchMerchant(merchantId, {
        bounds,
        ttl_seconds,
        catalog_patch: Object.keys(catalogDraft).length ? catalogDraft : undefined,
      });
      setLastChange(result);
      setData(result.data);
      setPassport(result.after);
      setDraft({ ...result.data.bounds, ttl_seconds: result.data.ttl_seconds });
      setCatalogDraft({});
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function setCatalogField(sku, field, value) {
    setCatalogDraft((prev) => ({ ...prev, [sku]: { ...prev[sku], [field]: value } }));
  }

  async function showPreview() {
    try {
      setPreview(await api.previewPassport(merchantId));
    } catch (e) {
      setError(e.message);
    }
  }

  if (!data) {
    return (
      <div className="page">
        <ErrorText>{error}</ErrorText>
        <Skeleton height={320} />
      </div>
    );
  }

  const costs = Object.fromEntries(data.catalog.items.map((i) => [i.sku, i.cost_minor ?? i.price_minor]));

  return (
    <div className="page cp-page">
      <header className="page-head">
        <div>
          <span className="tag emerald">
            <Icon.store size={11} /> Merchant control plane
          </span>
          <h1>{data.merchant.name}</h1>
          <p>
            The merchant's side of the wire. Everything here is private except what the generator
            deliberately publishes — change a rule and the passport is re-signed on the spot, and the
            next buyer query is decided against the new numbers.
          </p>
        </div>
        {merchants.length > 1 && (
          <div className="cp-merchant-switch">
            {merchants.map((m) => (
              <button
                key={m.merchant_id}
                className={m.merchant_id === merchantId ? "is-active" : ""}
                onClick={() => load(m.merchant_id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <ErrorText>{error}</ErrorText>

      <div className="cp-layout">
        <div className="cp-main">
          <Card>
            <CardHead
              title="Financial bounds"
              sub="Enforced by MarginMind from this file — never from anything a buyer sends"
              icon={<Icon.scale size={15} />}
            />
            <div className="cp-bounds">
              {BOUND_FIELDS.map((field) => {
                const value = draft[field.key];
                const original = data.bounds[field.key];
                const changed = value !== original;
                return (
                  <div className={`cp-bound${changed ? " is-changed" : ""}`} key={field.key}>
                    <div className="cp-bound-head">
                      <label htmlFor={field.key}>{field.label}</label>
                      <output className="cp-bound-value">
                        {field.money ? formatMinor(value) : `${value}${field.suffix ?? ""}`}
                        {changed && <span className="cp-bound-was">was {field.money ? formatMinor(original) : original}</span>}
                      </output>
                    </div>
                    <RangeSlider
                      id={field.key}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={value}
                      onChange={(e) => setDraft((d) => ({ ...d, [field.key]: Number(e.target.value) }))}
                    />
                    <p className="cp-bound-help">{field.help}</p>
                  </div>
                );
              })}

              <div className={`cp-bound${draft.ttl_seconds !== data.ttl_seconds ? " is-changed" : ""}`}>
                <div className="cp-bound-head">
                  <label htmlFor="ttl">Passport TTL</label>
                  <output className="cp-bound-value">{draft.ttl_seconds}s</output>
                </div>
                <RangeSlider
                  id="ttl"
                  min={30}
                  max={3600}
                  step={30}
                  value={draft.ttl_seconds}
                  onChange={(e) => setDraft((d) => ({ ...d, ttl_seconds: Number(e.target.value) }))}
                />
                <p className="cp-bound-help">
                  How long a buyer agent may trust a fetched copy. Short on purpose, so freshness is
                  demonstrable rather than theoretical.
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Catalog"
              sub="cost is merchant-private — the generator's allowlist keeps it out of the signed passport"
              icon={<Icon.file size={15} />}
              action={
                <button className="btn btn-sm btn-ghost" onClick={showPreview}>
                  <Icon.search size={13} /> Preview what goes public
                </button>
              }
            />
            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th className="num">Price</th>
                    <th className="num">
                      Cost <span className="cp-private">private</span>
                    </th>
                    <th className="num">Margin</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {data.catalog.items.map((item) => {
                    const price = catalogDraft[item.sku]?.price_minor ?? item.price_minor;
                    const cost = catalogDraft[item.sku]?.cost_minor ?? costs[item.sku];
                    const margin = price ? Math.round(((price - cost) / price) * 1000) / 10 : 0;
                    const belowFloor = margin < draft.min_margin_percent;
                    return (
                      <tr key={item.sku} className={catalogDraft[item.sku] ? "is-changed" : ""}>
                        <td className="mono xs">{item.sku}</td>
                        <td>{item.name}</td>
                        <td className="num">
                          <input
                            type="number"
                            value={price}
                            step={100}
                            min={0}
                            onChange={(e) => setCatalogField(item.sku, "price_minor", Number(e.target.value))}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            value={cost}
                            step={100}
                            min={0}
                            onChange={(e) => setCatalogField(item.sku, "cost_minor", Number(e.target.value))}
                          />
                        </td>
                        <td className={`num mono ${belowFloor ? "text-rose" : "text-emerald"}`}>
                          {margin}%{belowFloor && <span title="Below the margin floor — MarginMind will refuse to sell this"> ⚠</span>}
                        </td>
                        <td>
                          <select
                            value={catalogDraft[item.sku]?.stock ?? item.stock}
                            onChange={(e) => setCatalogField(item.sku, "stock", e.target.value)}
                          >
                            <option value="in_stock">in stock</option>
                            <option value="low_stock">low stock</option>
                            <option value="out_of_stock">out of stock</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="cp-hint">
              Prices are in paise. A margin below the floor is not blocked here — the merchant is allowed to
              hold a low-margin SKU. MarginMind simply refuses to build a basket around it.
            </p>
          </Card>
        </div>

        <aside className="cp-side">
          <SignatureCard passport={passport} lastChange={lastChange} busy={busy} />

          <button
            className={`btn btn-lg cp-publish${dirty ? " btn-primary" : ""}`}
            onClick={publish}
            disabled={!dirty || busy}
          >
            {busy ? (
              <>
                <span className="spinner" /> Signing…
              </>
            ) : (
              <>
                <Icon.lock size={15} /> {dirty ? "Publish & re-sign" : "No changes to publish"}
              </>
            )}
          </button>

          <p className="cp-side-note">
            Publishing writes the merchant's config, signs a new passport, and takes effect immediately —
            MarginMind re-reads this file on every decision, so there is no cache to invalidate and no
            restart to hide behind.
          </p>
        </aside>
      </div>

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal cp-preview" onClick={(e) => e.stopPropagation()}>
            <CardHead
              title="What becomes public"
              sub="The exact document a buyer agent fetches — note there is no cost field anywhere in it"
              icon={<Icon.search size={15} />}
              action={
                <button className="btn btn-sm btn-ghost" onClick={() => setPreview(null)}>
                  <Icon.x size={14} />
                </button>
              }
            />
            <JsonBlock value={preview} maxHeight="60vh" />
          </div>
        </div>
      )}
    </div>
  );
}
