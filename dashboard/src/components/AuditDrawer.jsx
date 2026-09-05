import { useEffect } from "react";
import { Icon } from "./ui.jsx";
import AuditFeed from "./AuditFeed.jsx";

/**
 * A viewport-fixed bottom sheet, toggled by a small tab that stays visible
 * regardless of scroll position. Deliberately not a full-page navigation —
 * the point is to glance at the audit trail without losing the conversation
 * underneath.
 */
export default function AuditDrawer({ events, open, onToggle, onOpenFull }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onToggle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  return (
    <>
      <button
        className={`audit-fab ${open ? "open" : ""}`}
        onClick={() => onToggle(!open)}
        aria-expanded={open}
      >
        <span className="live-dot" />
        Audit log
        <span className="chip">{events.length}</span>
        <Icon.chevron size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      <div className={`audit-sheet ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="audit-sheet-head">
          <div className="card-title">
            <Icon.file size={15} /> Audit log <span className="live-dot" style={{ marginLeft: 2 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {onOpenFull && (
              <button className="btn btn-sm btn-ghost" onClick={onOpenFull}>
                Full page <Icon.arrowRight size={12} />
              </button>
            )}
            <button className="btn-icon btn-ghost" onClick={() => onToggle(false)} aria-label="Close audit log">
              <Icon.x size={15} />
            </button>
          </div>
        </div>
        <div className="audit-sheet-body">
          <AuditFeed events={events} fill emptyHint="No events yet — send a request to populate the log." />
        </div>
      </div>
    </>
  );
}
