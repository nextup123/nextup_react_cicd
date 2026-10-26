// Settings: one section per page or area, holding what is set once rather
// than every run (homes, tool offset, overspeed limits …), and below them the
// tools that fill the whole area (Driver Settings, Software Update). The
// sections come from settingsRegistry.jsx. URL: /setup/<section>[/<tab>].
import { Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, Loading, cx } from "../../components/ui";
import { PageErrorBoundary } from "../../layout/PageErrorBoundary";
import { SETTINGS } from "./settingsRegistry";
import "./settings.css";

const MAIN = SETTINGS.filter((s) => s.group !== "tools");
const TOOLS = SETTINGS.filter((s) => s.group === "tools");

function NavItem({ s, active, onClick }) {
  return (
    <button type="button" className={cx("st-nav-item", active && "is-active")} data-tut={`st-nav-${s.id}`} onClick={onClick}>
      <s.icon size={17} />
      <span className="col" style={{ gap: 0, minWidth: 0 }}>
        <span className="st-nav-label">{s.label}</span>
        <span className="st-nav-count">{s.page ? s.hint : `${s.items.length} ${s.items.length === 1 ? "setting" : "settings"}`}</span>
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const wanted = pathname.split("/")[2];
  const section = SETTINGS.find((s) => s.id === wanted) || SETTINGS[0];
  const go = (s) => navigate(`/setup/${s.id}`);

  return (
    <div className="page st-page">
      <div className="st-side">
        <nav className="st-nav" data-tut="st-nav" aria-label="Settings sections">
          {MAIN.map((s) => <NavItem key={s.id} s={s} active={s.id === section.id} onClick={() => go(s)} />)}
        </nav>
        <nav className="st-nav st-nav-tools" data-tut="st-nav-tools" aria-label="Drive and software tools">
          {TOOLS.map((s) => <NavItem key={s.id} s={s} active={s.id === section.id} onClick={() => go(s)} />)}
        </nav>
      </div>

      <div className={cx("st-content", section.page && "st-content-wide")}>
        <header className="st-head" data-tut="st-head">
          <h2>{section.label}</h2>
          {section.description && <p className="muted">{section.description}</p>}
        </header>
        {section.page ? (
          <PageErrorBoundary>
            <Suspense fallback={<Loading label="Loading…" />}>
              <section.page />
            </Suspense>
          </PageErrorBoundary>
        ) : section.items.map((item) => (
          <Card key={item.id} title={item.title} subtitle={item.description} className="st-card" tut={`st-${item.id}`}>
            <PageErrorBoundary>
              <item.component />
            </PageErrorBoundary>
          </Card>
        ))}
      </div>
    </div>
  );
}
