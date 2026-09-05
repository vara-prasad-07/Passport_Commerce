import { useCallback, useEffect, useRef, useState } from "react";
import { STREAM_URLS, api } from "../api.js";
import { SPEEDS } from "../lib/theatre.js";
import { useAgentRun } from "../lib/useAgentRun.js";
import { ENGINE_LABEL, ENGINE_TONE } from "../lib/topology.js";
import AgentCanvas from "../components/AgentCanvas.jsx";
import ChatInputBar from "../components/ChatInputBar.jsx";
import SidePanel from "../components/SidePanel.jsx";
import { PaceControl, TraceRail } from "../components/TracePanels.jsx";
import { ErrorText, Icon } from "../components/ui.jsx";

/*
 * The Live Demo, staged in three acts.
 *
 *   idle       An empty room and a single input. Nothing else — no nodes, no
 *              legend, no timeline. There is nothing to look at yet because
 *              nothing has happened yet, and a diagram of a system that is
 *              not running is just clutter you have to explain around.
 *
 *   handshake  The message is sent. The buyer agent and the model appear,
 *              alone, and one packet goes out asking the only question worth
 *              asking first: is this a shopping request at all?
 *
 *   live       It was. The rest of the world assembles outward from the buyer
 *              agent and the real pipeline runs across it.
 *
 * If the answer is no, the world never assembles: one packet comes back red,
 * the room empties, and the buyer is told what to ask instead. That is not a
 * UI trick — the pipeline genuinely stops after that hop, so a merchant is
 * never contacted, and showing one would be a lie told in pixels.
 */

const PRESETS = [
  {
    label: "Happy path",
    text: "Find me vegetarian, high-protein breakfast for two people under ₹900, delivered tomorrow, in Bangalore.",
  },
  {
    label: "Tight budget",
    text: "I want a vegan snack for one person, delivered today, under ₹120.",
  },
  {
    label: "Wrong region",
    text: "Vegetarian lunch for one under ₹400, delivered tomorrow in Mumbai.",
  },
];

/** The engine legend, small enough to live in the HUD instead of the stage. */
function Legend() {
  return (
    <div className="hud-legend">
      {Object.entries(ENGINE_LABEL).map(([engine, label]) => (
        <span key={engine} className={`hud-legend-item tone-${ENGINE_TONE[engine]}`} title={label}>
          <i />
          {label}
        </span>
      ))}
    </div>
  );
}

export default function Demo({ initialCorrelationId, onActivity, onOrderReady, navigate }) {
  const [correlationId, setCorrelationId] = useState(initialCorrelationId);
  const [message, setMessage] = useState("");
  const [asked, setAsked] = useState(null);
  const [stage, setStage] = useState("idle"); // idle | handshake | live
  const [mode, setMode] = useState("query"); // query | confirm
  const [rejection, setRejection] = useState(null);
  const [queryResult, setQueryResult] = useState(null);
  const [selectedBasketId, setSelectedBasketId] = useState(null);
  const [selectedHopId, setSelectedHopId] = useState(null);
  const [confirmError, setConfirmError] = useState(null);

  const runner = useAgentRun({ speed: 0.5 });
  const { theatre, run, reset, speed, setSpeed, busy, running, settling, result, error } = runner;
  const handledRef = useRef(null);

  useEffect(() => {
    if (!correlationId && initialCorrelationId) setCorrelationId(initialCorrelationId);
  }, [initialCorrelationId, correlationId]);

  /* The world assembles on PLAYBACK time, not on network time. The gate's
     result is read out of the theatre rather than the raw response, so at
     0.25x the room fills at the pace the viewer is watching, in step with the
     packet that earned it. */
  useEffect(
    () =>
      theatre.subscribe(() => {
        setStage((prev) => {
          if (prev !== "handshake") return prev;
          const gate = theatre.snapshot().hops[0];
          if (!gate || gate.status === "running") return prev;
          // Hold at "rejecting" rather than dropping straight to idle: the
          // refusal packet is still travelling back, and clearing the stage
          // now would delete the very thing worth seeing. The result handler
          // empties the room once playback has actually finished.
          return gate.status === "blocked" && gate.code === "NOT_A_PURCHASE_REQUEST"
            ? "rejecting"
            : "live";
        });
      }),
    [theatre]
  );

  // A completed run lands here once the canvas has finished playing it.
  useEffect(() => {
    if (!result || handledRef.current === result) return;
    handledRef.current = result;
    onActivity?.();

    if (mode === "query") {
      if (result.stage === "not_a_purchase_request") {
        setRejection(result.message);
        setQueryResult(null);
        setStage("idle");
      } else {
        setQueryResult(result);
        setSelectedBasketId(result.decision?.options?.[0]?.basket_id ?? null);
      }
    } else if (result.status === "declined") {
      setConfirmError(result.message || result.code || "The order was declined.");
    } else if (result.status) {
      onOrderReady?.(result);
    }
  }, [result, mode, onActivity, onOrderReady]);

  const send = useCallback(
    async (rawText) => {
      const text = (rawText ?? message).trim();
      if (!text || !correlationId || busy) return;
      setAsked(text);
      setMessage("");
      setMode("query");
      setRejection(null);
      setQueryResult(null);
      setSelectedHopId(null);
      setConfirmError(null);
      handledRef.current = null;
      // Every query starts from the handshake, even mid-session: the gate
      // really does run again, and pretending otherwise would let an
      // off-topic follow-up sit inside an already-assembled world.
      setStage("handshake");
      await run(STREAM_URLS.query, { correlation_id: correlationId, message: text });
    },
    [message, correlationId, busy, run]
  );

  const confirm = useCallback(async () => {
    if (!selectedBasketId || busy) return;
    setMode("confirm");
    setConfirmError(null);
    setSelectedHopId(null);
    handledRef.current = null;
    setStage("live");
    await run(STREAM_URLS.confirm, { correlation_id: correlationId, basket_id: selectedBasketId });
  }, [selectedBasketId, correlationId, busy, run]);

  const newRun = useCallback(async () => {
    reset();
    setAsked(null);
    setStage("idle");
    setRejection(null);
    setQueryResult(null);
    setSelectedBasketId(null);
    setSelectedHopId(null);
    setConfirmError(null);
    handledRef.current = null;
    try {
      const session = await api.startSession();
      setCorrelationId(session.correlation_id);
    } catch {
      /* keep the existing session — a failed reset is worse than a stale id */
    }
  }, [reset]);

  const hops = theatre.snapshot().hops;
  const activeHop = selectedHopId ? hops.find((h) => h.hopId === selectedHopId) : null;
  const panelOpen = Boolean(activeHop || (queryResult && stage === "live"));
  const idle = stage === "idle";
  const showChrome = stage === "handshake" || stage === "rejecting" || stage === "live";

  return (
    <div className={`cinema stage-${stage}${panelOpen ? " has-panel" : ""}`}>
      <div className="cinema-body">
        <div className="cinema-stage-col">
        {showChrome && (
          <div className="cinema-hud">
            <div className="hud-left">
              <span className="hud-status">
                <span className="live-dot" data-on={busy ? "true" : "false"} />
                {running ? "Streaming" : settling ? "Playing back" : "Done"}
              </span>
              {asked && <span className="hud-asked">{asked}</span>}
            </div>
            <div className="hud-right">
              <Legend />
              <PaceControl speed={speed} onChange={setSpeed} speeds={SPEEDS} totalMs={theatre.snapshot().totalMs} />
              <button className="btn btn-sm btn-ghost" onClick={newRun} disabled={running}>
                <Icon.plus size={13} /> New
              </button>
            </div>
          </div>
        )}

          <AgentCanvas
            theatre={theatre}
            stage={stage}
            onSelectHop={setSelectedHopId}
            onSelectNode={() => {}}
          />

          {idle && (
            <div className="idle-hero">
              <h1>What do you need?</h1>
              <p>Describe what you want to buy. Nothing starts until it's a real request.</p>
            </div>
          )}

          {rejection && (
            <div className="reject-card rise" role="status">
              <span className="reject-mark">
                <Icon.ban size={16} />
              </span>
              <p>{rejection}</p>
              <span className="reject-note">
                One hop. No merchant was contacted, no passport fetched, nothing decided.
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setRejection(null)}>
                Got it
              </button>
            </div>
          )}

          {showChrome && <TraceRail theatre={theatre} activeHopId={selectedHopId} onSelect={setSelectedHopId} />}

          {/* One composer element in two places — the class change animates it
              from the middle of the room down to the dock, so the input the
              user just typed into is the same object they keep talking to. */}
          <div className={`composer ${idle ? "is-center" : "is-dock"}`}>
            <ChatInputBar
              value={message}
              onChange={setMessage}
              onSend={() => send()}
              disabled={!correlationId || busy}
              loading={busy}
              autoFocus
              large={idle}
              placeholder={
                busy ? "Working — watch the room…" : "e.g. high-protein breakfast for two under ₹900"
              }
            />
            {idle && (
              <div className="composer-presets">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => send(p.text)} disabled={!correlationId}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {!idle && (
              <p className="composer-hint">
                click any packet to inspect it ·{" "}
                <button className="linkish" onClick={() => navigate("audit")}>
                  the same events land in the audit trail
                </button>
              </p>
            )}
          </div>

          {error && (
            <div className="cinema-error">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </div>

        <SidePanel
          open={panelOpen}
          hop={activeHop}
          result={queryResult}
          selectedBasketId={selectedBasketId}
          onSelectBasket={setSelectedBasketId}
          onConfirm={confirm}
          confirming={mode === "confirm" && busy}
          confirmError={confirmError}
          onCloseHop={() => setSelectedHopId(null)}
          onClose={() => setQueryResult(null)}
        />
      </div>
    </div>
  );
}
