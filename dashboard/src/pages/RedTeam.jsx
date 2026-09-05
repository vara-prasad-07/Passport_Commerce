import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STREAM_URLS, api } from "../api.js";
import { SPEEDS } from "../lib/theatre.js";
import { useAgentRun } from "../lib/useAgentRun.js";
import AgentCanvas from "../components/AgentCanvas.jsx";
import { HopInspector, PaceControl, TraceRail } from "../components/TracePanels.jsx";
import { Card, CardHead, ErrorText, Icon, JsonBlock } from "../components/ui.jsx";

/*
 * The Red Team console.
 *
 * A judge does not have to take the guarantees on trust — they can fire the
 * attacks themselves, in any order, against the same running services, and
 * watch each one stop on the canvas at the exact boundary that refuses it.
 *
 * The scoreboard reports "blocked" and "GOT THROUGH" with equal prominence.
 * A security tool that can only report good news is a decoration, and the
 * moment this page cannot show a failure is the moment it stops being
 * evidence of anything.
 */

/** Resolves once the canvas has finished playing whatever it was given. */
function waitForIdle(theatre, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (!theatre || !theatre.busy) return resolve();
    const started = Date.now();
    const unsubscribe = theatre.subscribe(() => {
      if (!theatre.busy || Date.now() - started > timeoutMs) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function Scoreboard({ results, total }) {
  const run = Object.values(results);
  const blocked = run.filter((r) => r.outcome === "blocked").length;
  const through = run.filter((r) => r.outcome === "allowed").length;
  const money = run.reduce((sum, r) => sum + (r.orders_created ?? 0), 0);

  return (
    <div className="rt-score">
      <div className="rt-score-cell">
        <span className="rt-score-num">
          {blocked}
          <span className="dim">/{total}</span>
        </span>
        <span className="rt-score-label">attacks blocked</span>
      </div>
      <div className={`rt-score-cell${through ? " is-bad" : ""}`}>
        <span className="rt-score-num">{through}</span>
        <span className="rt-score-label">{through ? "GOT THROUGH" : "got through"}</span>
      </div>
      <div className="rt-score-cell">
        <span className="rt-score-num">{money}</span>
        <span className="rt-score-label">
          unintended orders
          <span className="dim xs"> · counted from the live order store</span>
        </span>
      </div>
    </div>
  );
}

function AttackCard({ attack, result, running, onRun, expanded, onToggle }) {
  const outcome = result?.outcome;
  const state = running ? "running" : outcome === "blocked" ? "blocked" : outcome === "allowed" ? "allowed" : "idle";

  return (
    <Card className={`rt-card is-${state}`}>
      <div className="rt-card-head">
        <div className="rt-card-title">
          <span className="rt-card-cat">{attack.category}</span>
          <h3>{attack.title}</h3>
        </div>
        <button className="btn btn-sm" onClick={() => onRun(attack.id)} disabled={running}>
          {running ? (
            <>
              <span className="spinner" /> Running
            </>
          ) : (
            <>
              <Icon.activity size={13} /> {result ? "Re-run" : "Attack"}
            </>
          )}
        </button>
      </div>

      <p className="rt-card-story">{attack.story}</p>

      <div className="rt-card-expect">
        <Icon.shield size={12} />
        <span>{attack.expect}</span>
      </div>

      {result && (
        <>
          <div className={`rt-verdict is-${outcome}`}>
            {outcome === "blocked" ? <Icon.shieldCheck size={15} /> : <Icon.alert size={15} />}
            <div>
              <b>{outcome === "blocked" ? "Blocked" : "GOT THROUGH — this is a finding"}</b>
              <span>
                {outcome === "blocked" ? (
                  <>
                    by {result.blocked_by}
                    {result.code && (
                      <>
                        {" · "}
                        <code className="code-inline">{result.code}</code>
                      </>
                    )}
                  </>
                ) : (
                  "The control that should have stopped this did not."
                )}
              </span>
            </div>
            <span className="rt-verdict-ms">{Math.round(result.elapsed_ms ?? 0)}ms</span>
          </div>

          <div className="rt-facts">
            <span className={result.orders_created ? "text-amber" : "text-emerald"}>
              <b>{result.orders_created}</b> order{result.orders_created === 1 ? "" : "s"} created
            </span>
            <span className={result.money_action_taken ? "text-amber" : "text-emerald"}>
              money action: <b>{result.money_action_taken ? "yes" : "none"}</b>
            </span>
          </div>

          {result.note && (
            <div className="callout decline" style={{ marginTop: 10 }}>
              <div>{result.note}</div>
            </div>
          )}

          <button className="rt-evidence-toggle" onClick={() => onToggle(attack.id)}>
            <Icon.chevron size={12} style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
            {expanded ? "Hide" : "Show"} the evidence
          </button>

          {expanded && (
            <div className="rt-evidence">
              <p className="dim xs" style={{ marginBottom: 8 }}>
                Defence: <code className="code-inline">{attack.defence}</code>
              </p>
              <JsonBlock value={result.evidence} maxHeight={300} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function RedTeam({ onActivity }) {
  const [attacks, setAttacks] = useState([]);
  const [results, setResults] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [selectedHopId, setSelectedHopId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [runningAll, setRunningAll] = useState(false);

  const runner = useAgentRun({ speed: 0.5 });
  const { theatre, run, reset, speed, setSpeed, busy, result, error } = runner;
  const handledRef = useRef(null);
  const cancelAllRef = useRef(false);

  useEffect(() => {
    api
      .redteamAttacks()
      .then((data) => setAttacks(data.attacks))
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (!result || handledRef.current === result) return;
    handledRef.current = result;
    if (result.id) setResults((prev) => ({ ...prev, [result.id]: result }));
    onActivity?.();
  }, [result, onActivity]);

  const runAttack = useCallback(
    async (attackId) => {
      setActiveId(attackId);
      setSelectedHopId(null);
      handledRef.current = null;
      await run(STREAM_URLS.redteam, { attack_id: attackId });
      await waitForIdle(theatre);
      setActiveId(null);
    },
    [run, theatre]
  );

  const runAll = useCallback(async () => {
    cancelAllRef.current = false;
    setRunningAll(true);
    setSpeed(1);
    for (const attack of attacks) {
      if (cancelAllRef.current) break;
      await runAttack(attack.id);
    }
    setRunningAll(false);
  }, [attacks, runAttack, setSpeed]);

  const grouped = useMemo(() => {
    const byCategory = new Map();
    for (const attack of attacks) {
      if (!byCategory.has(attack.category)) byCategory.set(attack.category, []);
      byCategory.get(attack.category).push(attack);
    }
    return [...byCategory.entries()];
  }, [attacks]);

  return (
    <div className="page rt-page">
      <header className="rt-head">
        <div>
          <span className="tag rose">
            <Icon.ban size={11} /> Red team
          </span>
          <h1>Attack the agent</h1>
          <p>
            Every attack below runs against the live services, through the ordinary code path — the same
            signature check, the same bounds gate, the same idempotency key. Nothing here is staged to fail.
            Watch where each one stops.
          </p>
        </div>
        <div className="rt-head-actions">
          <button className="btn btn-primary" onClick={runAll} disabled={busy || runningAll || !attacks.length}>
            {runningAll ? (
              <>
                <span className="spinner" /> Running all…
              </>
            ) : (
              <>
                <Icon.activity size={14} /> Run all {attacks.length}
              </>
            )}
          </button>
          {runningAll && (
            <button className="btn btn-sm btn-ghost" onClick={() => (cancelAllRef.current = true)}>
              Stop
            </button>
          )}
        </div>
      </header>

      <ErrorText>{loadError}</ErrorText>

      {attacks.length > 0 && <Scoreboard results={results} total={attacks.length} />}

      <div className="rt-stage">
        <div className="rt-stage-bar">
          <span className="cinema-badge">
            <span className="live-dot" data-on={busy ? "true" : "false"} />
            {activeId ? attacks.find((a) => a.id === activeId)?.title ?? "Running" : "Pick an attack"}
          </span>
          <PaceControl speed={speed} onChange={setSpeed} speeds={SPEEDS} totalMs={theatre?.snapshot().totalMs} />
        </div>
        <AgentCanvas theatre={theatre} activeHopId={selectedHopId} onSelectHop={setSelectedHopId} />
        <TraceRail theatre={theatre} activeHopId={selectedHopId} onSelect={setSelectedHopId} />
        <HopInspector theatre={theatre} hopId={selectedHopId} onClose={() => setSelectedHopId(null)} />
      </div>

      <ErrorText>{error}</ErrorText>

      {grouped.map(([category, list]) => (
        <section key={category} className="rt-group">
          <h2 className="rt-group-title">{category}</h2>
          <div className="rt-grid">
            {list.map((attack) => (
              <AttackCard
                key={attack.id}
                attack={attack}
                result={results[attack.id]}
                running={activeId === attack.id}
                onRun={runAttack}
                expanded={Boolean(expanded[attack.id])}
                onToggle={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
