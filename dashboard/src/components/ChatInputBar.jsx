import { useEffect, useRef } from "react";
import { Icon } from "./ui.jsx";

/**
 * The single, always-present composer — pinned at the bottom of the chat
 * column in both the empty and populated states, so sending a message never
 * requires hunting for a different input.
 */
export default function ChatInputBar({
  value,
  onChange,
  onSend,
  disabled,
  loading,
  placeholder = "Message the buyer agent…",
  large = false,
  autoFocus = false,
}) {
  const ref = useRef(null);

  // Auto-grow up to a cap, then let the textarea's own scrollbar take over —
  // avoids the composer swallowing the whole screen on a long paste.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, large ? 200 : 140)}px`;
  }, [value, large]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const canSend = !disabled && !loading && value.trim().length > 0;

  return (
    <div className={`chat-input-bar ${large ? "large" : ""}`}>
      <textarea
        ref={ref}
        rows={1}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <button
        className="chat-send-btn"
        onClick={onSend}
        disabled={!canSend}
        aria-label="Send"
        title="Send — Enter"
      >
        {loading ? <span className="spinner" /> : <Icon.send size={16} />}
      </button>
    </div>
  );
}
