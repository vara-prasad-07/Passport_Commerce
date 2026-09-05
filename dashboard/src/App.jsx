import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { useHashRoute, useTheme } from "./lib/hooks.js";
import Nav from "./components/Nav.jsx";
import CheckoutModal from "./components/CheckoutModal.jsx";
import Overview from "./pages/Overview.jsx";
import Demo from "./pages/Demo.jsx";
import Registry from "./pages/Registry.jsx";
import Passport from "./pages/Passport.jsx";
import ControlPlane from "./pages/ControlPlane.jsx";
import RiskPolicy from "./pages/RiskPolicy.jsx";
import RedTeam from "./pages/RedTeam.jsx";
import Audit from "./pages/Audit.jsx";

/* The Live Demo is a full-bleed stage, so it opts out of the page chrome the
   other routes share. */
const FULL_BLEED = new Set(["demo"]);

export default function App() {
  const [route, navigate] = useHashRoute();
  const [theme, toggleTheme] = useTheme();

  const [correlationId, setCorrelationId] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);

  const [passport, setPassport] = useState(null);
  const [passportLoading, setPassportLoading] = useState(true);
  const [passportError, setPassportError] = useState(null);

  const [auditEvents, setAuditEvents] = useState([]);
  const [auditFilter, setAuditFilter] = useState(null);

  const [activeOrder, setActiveOrder] = useState(null);

  const loadPassport = useCallback(async () => {
    setPassportLoading(true);
    setPassportError(null);
    try {
      setPassport(await api.passportSummary());
    } catch (e) {
      setPassportError(e.message);
    } finally {
      setPassportLoading(false);
    }
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const data = await api.audit(auditFilter, 150);
      setAuditEvents(data.events);
    } catch {
      // Audit polling failures shouldn't be loud — the nav status pill already
      // reports whether the buyer agent is reachable.
    }
  }, [auditFilter]);

  useEffect(() => {
    (async () => {
      try {
        setHealth(await api.health());
      } catch (e) {
        setHealthError(e.message);
      }
    })();
    api
      .startSession()
      .then((s) => setCorrelationId(s.correlation_id))
      .catch(() => {});
    loadPassport();
  }, [loadPassport]);

  useEffect(() => {
    refreshAudit();
    const id = setInterval(refreshAudit, 2500);
    return () => clearInterval(id);
  }, [refreshAudit]);

  const handleActivity = useCallback(() => refreshAudit(), [refreshAudit]);

  /* A merchant edit re-signs the passport, so the header's verification pill
     and the Passport page must be re-fetched or they would keep showing the
     signature of a document that no longer exists. */
  const handleMerchantChanged = useCallback(() => {
    loadPassport();
    refreshAudit();
  }, [loadPassport, refreshAudit]);

  const fullBleed = FULL_BLEED.has(route);

  return (
    <div className="app">
      <Nav
        route={route}
        navigate={navigate}
        theme={theme}
        onToggleTheme={toggleTheme}
        health={health}
        healthError={healthError}
        passport={passport}
      />

      {route === "overview" && (
        <Overview
          navigate={navigate}
          health={health}
          healthError={healthError}
          passport={passport}
          passportLoading={passportLoading}
        />
      )}

      {route === "demo" && (
        <Demo
          initialCorrelationId={correlationId}
          onActivity={handleActivity}
          onOrderReady={setActiveOrder}
          navigate={navigate}
        />
      )}

      {route === "registry" && <Registry onActivity={handleActivity} />}

      {route === "passport" && (
        <Passport
          passport={passport}
          loading={passportLoading}
          error={passportError}
          onRefresh={loadPassport}
        />
      )}

      {route === "merchant" && <ControlPlane onChanged={handleMerchantChanged} />}

      {route === "policy" && <RiskPolicy onChanged={handleActivity} />}

      {(route === "redteam" || route === "guardrails") && <RedTeam onActivity={handleActivity} />}

      {route === "audit" && (
        <Audit events={auditEvents} correlationId={auditFilter} onClearFilter={() => setAuditFilter(null)} />
      )}

      {!fullBleed && (
        <footer className="footer">
          <div className="footer-inner">
            <span>
              <b style={{ color: "var(--text-2)" }}>Passport Commerce</b> — Merchant Passport + MarginMind. Razorpay
              AI Buildathon, Track 01. All transactions are test-mode or simulated; no real money moves.
            </span>
            <div className="footer-links">
              <button onClick={() => navigate("overview")}>Overview</button>
              <button onClick={() => navigate("demo")}>Live Demo</button>
              <button onClick={() => navigate("registry")}>Registry</button>
              <button onClick={() => navigate("merchant")}>Merchant</button>
              <button onClick={() => navigate("redteam")}>Red Team</button>
              <button onClick={() => navigate("audit")}>Audit</button>
            </div>
          </div>
        </footer>
      )}

      {activeOrder && (
        <CheckoutModal
          order={activeOrder}
          onClose={() => setActiveOrder(null)}
          onPaid={() => refreshAudit()}
        />
      )}
    </div>
  );
}
