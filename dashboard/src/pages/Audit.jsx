import { useMemo, useState } from "react";
import { Card, CardHead, Icon, Stat } from "../components/ui.jsx";
import AuditFeed from "../components/AuditFeed.jsx";

export default function Audit({ events, correlationId, onClearFilter }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) =>
      [e.actor, e.event_type, e.outcome, e.decision, e.correlation_id]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    );
  }, [events, query]);

  const stats = useMemo(() => {
    const actors = new Set();
    const correlations = new Set();
    let declines = 0;
    for (const e of events) {
      if (e.actor) actors.add(e.actor);
      if (e.correlation_id) correlations.add(e.correlation_id);
      if (e.decision === "declined" || e.decision === "rejected" || e.decision === "failed") declines += 1;
    }
    return { actors: actors.size, correlations: correlations.size, declines };
  }, [events]);

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="eyebrow">Audit trail</div>
        <h1 className="section-title">Every decision, in one append-only log</h1>
        <p>
          One correlation id links a passport fetch to a MarginMind decision to an order to a payment, across three
          separate services. Declines and failures are written to the same feed as the successes — click any row to
          see the full recorded detail.
        </p>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat icon={<Icon.activity size={13} />} label="Events recorded" value={events.length} foot="most recent first" />
        <Stat icon={<Icon.route size={13} />} label="Correlation ids" value={stats.correlations} foot="distinct traces" />
        <Stat icon={<Icon.cpu size={13} />} label="Actors" value={stats.actors} foot="services writing to the log" />
        <Stat
          icon={<Icon.ban size={13} />}
          label="Blocked or failed"
          value={stats.declines}
          tone={stats.declines ? "rose" : undefined}
          foot="never hidden from the feed"
        />
      </div>

      <Card>
        <CardHead
          title={
            <>
              Feed <span className="live-dot" style={{ marginLeft: 4 }} />
            </>
          }
          icon={<Icon.file size={16} />}
          sub="Polled from the buyer agent every 2.5 seconds."
          action={
            correlationId ? (
              <button className="btn btn-sm" onClick={onClearFilter}>
                <Icon.x size={12} /> Clear filter
              </button>
            ) : null
          }
        />

        <div className="card-body">
          <div className="audit-toolbar" style={{ marginBottom: 14 }}>
            <input
              className="audit-search"
              placeholder="Filter by actor, event type, outcome or correlation id…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="btn btn-sm btn-ghost" onClick={() => setQuery("")}>
                <Icon.x size={12} /> Clear
              </button>
            )}
            <span className="dim xs nowrap">
              {filtered.length} of {events.length}
            </span>
          </div>

          {correlationId && (
            <p className="small muted" style={{ marginBottom: 12 }}>
              Server-side filter active on <code className="code-inline">{correlationId}</code>.
            </p>
          )}

          <AuditFeed
            events={filtered}
            emptyHint={
              query ? "Nothing matches that filter." : "No events yet — run a request on the live demo page."
            }
          />
        </div>
      </Card>
    </div>
  );
}
