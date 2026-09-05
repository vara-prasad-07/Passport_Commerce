import { Fragment, useState } from "react";
import { Empty, Icon, JsonBlock } from "./ui.jsx";
import { timeOnly } from "../lib/format.js";

const GOOD = new Set(["accepted", "trusted", "paid", "ok"]);
const BAD = new Set(["declined", "rejected", "failed", "gave_up"]);

function outcomeClass(decision) {
  if (!decision) return "";
  if (GOOD.has(decision)) return "ok";
  if (BAD.has(decision)) return "bad";
  return "";
}

export default function AuditFeed({ events, compact = false, fill = false, emptyHint }) {
  const [openId, setOpenId] = useState(null);

  if (!events.length) {
    return (
      <Empty icon={<Icon.activity size={22} />}>
        {emptyHint ?? "No events yet — run a request and every step lands here."}
      </Empty>
    );
  }

  return (
    <div className={`audit-list ${compact ? "compact" : ""} ${fill ? "fill" : ""}`}>
      {events.map((e) => {
        const open = openId === e.event_id;
        const hasDetail = e.detail && Object.keys(e.detail).length > 0;
        return (
          <Fragment key={e.event_id}>
            <button
              className={`audit-row ${open ? "open" : ""}`}
              onClick={() => setOpenId(open ? null : e.event_id)}
              title={hasDetail ? "Show the recorded detail" : "No extra detail recorded"}
            >
              <span className="a-time">{timeOnly(e.timestamp)}</span>
              <span className={`a-actor ${e.actor}`}>{e.actor}</span>
              <span className="a-event">{e.event_type}</span>
              <span className="a-outcome">
                {e.decision && <span className={outcomeClass(e.decision)}>{e.decision}</span>}
                {e.decision && e.outcome ? " · " : ""}
                {e.outcome}
              </span>
            </button>
            {open && (
              <div className="audit-detail">
                <JsonBlock
                  value={{
                    event_id: e.event_id,
                    correlation_id: e.correlation_id,
                    timestamp: e.timestamp,
                    actor: e.actor,
                    event_type: e.event_type,
                    input_hash: e.input_hash,
                    decision: e.decision,
                    outcome: e.outcome,
                    detail: e.detail,
                  }}
                  maxHeight={260}
                />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
