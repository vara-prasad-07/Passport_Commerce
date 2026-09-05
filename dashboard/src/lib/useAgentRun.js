import { useCallback, useEffect, useRef, useState } from "react";
import { Theatre, streamSSE } from "./theatre.js";

/**
 * Runs a streamed pipeline and keeps the canvas, the transcript and the
 * result in step with each other.
 *
 * The subtle part is when the RESULT becomes visible. The server finishes
 * long before a 0.25× playback does, and revealing the baskets the moment
 * the response lands would put the answer on screen while packets are still
 * in the air — which reads as the animation being decorative. So the final
 * payload is held until the canvas has actually finished playing, and only
 * then handed to the UI.
 */
export function useAgentRun({ speed: initialSpeed = 0.5 } = {}) {
  const theatreRef = useRef(null);
  if (theatreRef.current === null) theatreRef.current = new Theatre({ speed: initialSpeed });
  const theatre = theatreRef.current;

  const abortRef = useRef(null);
  const pendingRef = useRef(null);

  const [speed, setSpeedState] = useState(initialSpeed);
  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);

  // Commit the held result once playback has drained.
  useEffect(
    () =>
      theatre.subscribe(() => {
        if (pendingRef.current && !theatre.busy) {
          const held = pendingRef.current;
          pendingRef.current = null;
          setSettling(false);
          if (held.error) setError(held.error);
          else setResult(held.value);
        }
      }),
    [theatre]
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      theatre.stop();
    },
    [theatre]
  );

  const setSpeed = useCallback(
    (factor) => {
      setSpeedState(factor);
      theatre.setSpeed(factor);
    },
    [theatre]
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    pendingRef.current = null;
    theatre.stop();
    theatre.reset();
    setRunning(false);
    setSettling(false);
    setResult(null);
    setError(null);
    setEvents([]);
  }, [theatre]);

  const run = useCallback(
    async (url, body) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      pendingRef.current = null;
      theatre.reset();
      theatre.setSpeed(speed);
      setRunning(true);
      setSettling(false);
      setResult(null);
      setError(null);
      setEvents([]);

      const collected = [];
      try {
        await streamSSE(url, body, {
          signal: controller.signal,
          onEvent: (event) => {
            collected.push(event);
            if (event.kind === "final") {
              pendingRef.current = { value: event.result };
            } else if (event.kind === "fatal") {
              pendingRef.current = { error: event.message };
            } else if (event.kind !== "open") {
              theatre.feed(event);
            }
          },
        });
        setEvents(collected);
        setRunning(false);
        // The stream is done but the canvas may still be mid-flight; say so,
        // so a "still working" spinner doesn't vanish before the animation.
        setSettling(Boolean(pendingRef.current) && theatre.busy);
        theatre.closeStream();
        if (pendingRef.current && !theatre.busy) {
          const held = pendingRef.current;
          pendingRef.current = null;
          if (held.error) setError(held.error);
          else setResult(held.value);
        }
      } catch (e) {
        if (e.name === "AbortError") return;
        theatre.closeStream();
        setRunning(false);
        setSettling(false);
        setError(e.message);
      }
    },
    [theatre, speed]
  );

  return {
    theatre,
    run,
    reset,
    setSpeed,
    speed,
    running,
    settling,
    busy: running || settling,
    result,
    error,
    events,
  };
}
