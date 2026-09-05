import { useEffect, useState } from "react";
import { Icon, Pill } from "./ui.jsx";

const LINKS = [
  { id: "overview", label: "Overview" },
  { id: "demo", label: "Live Demo" },
  { id: "registry", label: "Registry" },
  { id: "passport", label: "Passport" },
  { id: "merchant", label: "Merchant" },
  { id: "policy", label: "Risk Policy" },
  { id: "redteam", label: "Red Team", tone: "rose" },
  { id: "audit", label: "Audit" },
];

export default function Nav({ route, navigate, theme, onToggleTheme, health, healthError, passport }) {
  const [open, setOpen] = useState(false);

  // Close the mobile sheet whenever the route changes, otherwise it stays
  // open over the page the user just navigated to.
  useEffect(() => setOpen(false), [route]);

  function go(id) {
    navigate(id);
    setOpen(false);
  }

  return (
    <nav className="nav">
      <div className="brand" onClick={() => go("overview")} title="Passport Commerce">
        <span className="brand-mark">
          <Icon.shieldCheck size={17} />
        </span>
        <span className="brand-text">
          <span className="brand-name">Passport Commerce</span>
          <span className="brand-tag">Merchant Passport + MarginMind</span>
        </span>
      </div>

      <div className={`nav-links ${open ? "open" : ""}`}>
        {LINKS.map((l) => (
          <button
            key={l.id}
            className={`nav-link ${route === l.id ? "active" : ""}${l.tone ? ` tone-${l.tone}` : ""}`}
            onClick={() => go(l.id)}
            aria-current={route === l.id ? "page" : undefined}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="nav-right">
        <div className="nav-status">
          <Pill tone={healthError ? "bad" : health ? "ok" : ""} pulse={!health && !healthError}>
            {healthError ? "agent offline" : health ? "agent online" : "connecting"}
          </Pill>
          {passport && (
            <Pill tone={passport.trusted ? "ok" : "bad"}>
              {passport.trusted ? "passport verified" : "passport rejected"}
            </Pill>
          )}
        </div>

        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle colour theme"
        >
          {theme === "dark" ? <Icon.sun size={16} /> : <Icon.moon size={16} />}
        </button>

        <button
          className="theme-toggle nav-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          {open ? <Icon.x size={16} /> : <Icon.menu size={16} />}
        </button>
      </div>
    </nav>
  );
}
