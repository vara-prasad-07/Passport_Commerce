import { Icon } from "./ui.jsx";
import { relativeTime } from "../lib/format.js";

const GOOD_STAGES = new Set(["ready_for_consent"]);
const BAD_STAGES = new Set(["declined", "passport_rejected", "region_not_served"]);

function turnTone(turn) {
  if (turn.status === "running") return "run";
  if (turn.status === "error") return "bad";
  const stage = turn.result?.stage;
  if (GOOD_STAGES.has(stage)) return "ok";
  if (BAD_STAGES.has(stage)) return "bad";
  return "";
}

export default function ChatSidebar({ turns, onSelect, onNewChat, open, onToggle, correlationId }) {
  return (
    <>
      <aside className={`chat-sidebar ${open ? "" : "collapsed"}`}>
        <div className="chat-sidebar-inner">
          <button className="chat-newchat" onClick={onNewChat}>
            <Icon.plus size={15} /> New chat
          </button>

          <div className="chat-sidebar-label">This conversation</div>

          <div className="chat-sidebar-list">
            {turns.length === 0 && <p className="dim xs" style={{ padding: "0 12px" }}>No requests yet.</p>}
            {turns
              .slice()
              .reverse()
              .map((t) => (
                <button
                  key={t.id}
                  className="chat-sidebar-item"
                  onClick={() => onSelect(t.id)}
                  title={t.text}
                >
                  <span className={`chat-sidebar-dot ${turnTone(t)}`} />
                  <span className="chat-sidebar-text">{t.text}</span>
                  <span className="chat-sidebar-time">{relativeTime(t.createdAt)}</span>
                </button>
              ))}
          </div>

          {correlationId && (
            <div className="chat-sidebar-foot">
              <span className="dim xs mono truncate" title={correlationId}>
                {correlationId}
              </span>
            </div>
          )}
        </div>
      </aside>

      <button
        className={`chat-sidebar-toggle ${open ? "" : "collapsed"}`}
        onClick={onToggle}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        aria-label="Toggle conversation sidebar"
      >
        <Icon.chevronsLeft size={14} style={{ transform: open ? "none" : "rotate(180deg)" }} />
      </button>
    </>
  );
}
