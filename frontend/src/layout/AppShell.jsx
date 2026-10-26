import { Suspense, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, FolderOpen, GraduationCap, PanelLeftClose, PanelLeftOpen, Palette, Power, Settings } from "lucide-react";
import { Button, IconButton, Loading } from "../components/ui";
import { NAV, ROUTES } from "../nav";
import { useActiveProject } from "../lib/queries";
import { ConnectionPill, RobotStatus } from "./RobotStatus";
import { SafetyControls } from "./SafetyControls";
import { ModeChip } from "./ModeChip";
import { MotionChip } from "./MotionChip";
import { ProgramChip } from "./ProgramChip";
import { StatusDock } from "./StatusDock";
import { BtPausedBanner, EmergencyBanner, OperatorPrompt } from "./RobotBanners";
import { LogsDrawer } from "./LogsDrawer";
import { PowerMenu } from "./PowerMenu";
import { ThemeMenu } from "./ThemeMenu";
import { FloatingControls } from "./FloatingControls";
import { SystemInfo } from "./SystemInfo";
import { PageErrorBoundary, Safe } from "./PageErrorBoundary";
import { PageLoadFallback, PageMounted, usePageLoadWatch } from "./PageLoadGuard";
import { BusyPopup } from "./BusyPopup";
import { installReloadShortcuts, reloadApp, usePageReload } from "../lib/pageReload";
import { preloadPageCode } from "../lib/preload";
import { useIsDirty, useProjectSessionRunner } from "../store/projectSession";
import { TutorialHost } from "../tutorial/TutorialHost";
import { TutorialMenu } from "../tutorial/TutorialMenu";
import { openMenu, useTutorial } from "../tutorial/engine";

const COLLAPSE_KEY = "nextup.sidebarCollapsed";

/** The logo: a double click (or double tap) reloads the whole web app, like Settings › System › Reload web app. */
function LogoReload() {
  const last = useRef({ t: 0, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const onPointerUp = (e) => {
    const now = Date.now();
    const p = last.current;
    const near = Math.abs(e.clientX - p.x) < 24 && Math.abs(e.clientY - p.y) < 24;
    if (now - p.t < 400 && near) {
      last.current = { t: 0, x: 0, y: 0 };
      setBusy(true);
      setTimeout(() => reloadApp(), 150);
      return;
    }
    last.current = { t: now, x: e.clientX, y: e.clientY };
  };
  return (
    <img
      src="/nextup_logo_compact.png"
      alt="NextUp Robotics"
      className={busy ? "brand-logo is-reloading" : "brand-logo"}
      title="Double-click to reload the web app"
      draggable={false}
      onPointerUp={onPointerUp}
    />
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [logsOpen, setLogsOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const { data: active } = useActiveProject();
  useProjectSessionRunner();
  const dirty = useIsDirty();
  const location = useLocation();
  const navigate = useNavigate();
  const route = ROUTES.find((r) => location.pathname.startsWith(r.path));

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    document.title = route ? `${route.label} · NextUp` : "NextUp Robot Console";
  }, [route]);

  const projectName = active?.active_project;
  const tutSeen = useTutorial((s) => s.seen);
  const pageNonce = usePageReload((s) => s.nonce);
  useEffect(installReloadShortcuts, []);
  // once the first page is up, fetch every other page's code in the background
  useEffect(() => {
    const t = setTimeout(preloadPageCode, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`app ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <LogoReload />
          <IconButton
            className="collapse-btn"
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            size="sm"
            onClick={() => setCollapsed((c) => !c)}
          />
        </div>

        <button className="project-pill" onClick={() => navigate("/projects")} title={projectName ? `Active project: ${projectName}${dirty ? " (unsaved changes)" : ""}` : "No project loaded"}>
          <FolderOpen size={18} />
          <span className="proj-text col" style={{ gap: 0, minWidth: 0 }}>
            <span className="proj-label">Active project</span>
            <span className="proj-name truncate">{projectName || "None loaded"}</span>
            {dirty && <span className="proj-dirty">Unsaved changes</span>}
          </span>
        </button>

        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.section} className="col" style={{ gap: 2 }}>
              <div className="nav-section">{section.section}</div>
              {section.items.map((item) => (
                <NavLink key={item.path} to={item.path} className="nav-link" title={item.label} data-tut={`nav-${item.path.slice(1)}`}>
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-tools">
            <Button className="theme-btn btn-icon" variant="soft" icon={Palette} onClick={() => setThemeOpen(true)} title="Theme and mode" aria-label="Theme and mode">
              <span className="theme-dot" />
            </Button>
            <Button className="tut-btn btn-icon" variant="soft" icon={GraduationCap} onClick={() => openMenu(route?.path)} title="Tutorials: learn this page step by step" aria-label="Tutorials" data-tut="tutorials-btn">
              {!tutSeen && <span className="tut-btn-dot" />}
            </Button>
            <NavLink to="/setup" className={({ isActive }) => `btn btn-soft btn-icon settings-btn${isActive ? " is-active" : ""}`} title="Settings (one-time setup for each page)" aria-label="Settings">
              <Settings size={18} />
            </NavLink>
          </div>
          <SystemInfo />
          <div className="sidebar-actions">
            <Button className="power-btn" variant="soft-danger" icon={Power} onClick={() => setPowerOpen(true)} title="Power menu">
              <span>Power</span>
            </Button>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-page">
          {route?.icon && (
            <span className="topbar-icon">
              <route.icon size={19} />
            </span>
          )}
          <div className="topbar-title">
            <h1>{route?.label || "NextUp"}</h1>
            {route?.description && <span className="crumb">{route.description}</span>}
          </div>
        </div>
        <Safe><RobotStatus /></Safe>
        <Safe><ModeChip /></Safe>
        <Safe><MotionChip /></Safe>
        <Safe><ProgramChip /></Safe>
        <Safe><ConnectionPill /></Safe>
        <IconButton icon={Bell} label="Robot messages" onClick={() => setLogsOpen(true)} variant="default" />
        <span className="topbar-sep" />
        <Safe><SafetyControls /></Safe>
      </header>

      {/* Second row of the top bar: emergency / paused banners. It is in the
          page flow, so the page starts below it and nothing is covered. Empty
          (no height) when there is nothing to show. */}
      <div className="topbar-strip">
        <Safe><EmergencyBanner /></Safe>
        <Safe><BtPausedBanner /></Safe>
      </div>

      <main className="main">
        <PageFrame key={`${location.pathname}#${pageNonce}`} />
      </main>
      <Safe><FloatingControls /></Safe>
      {/* status panels float anywhere over the page */}
      <Safe><StatusDock /></Safe>
      <Safe><OperatorPrompt /></Safe>
      <LogsDrawer open={logsOpen} onClose={() => setLogsOpen(false)} />
      <PowerMenu open={powerOpen} onClose={() => setPowerOpen(false)} />
      <ThemeMenu open={themeOpen} onClose={() => setThemeOpen(false)} />
      <Safe><TutorialMenu /></Safe>
      <Safe><TutorialHost /></Safe>
      <Safe><BusyPopup /></Safe>
    </div>
  );
}

/** One page in the main area: its error boundary, its loading state and the 5 s load watch. */
function PageFrame() {
  const hostRef = useRef(null);
  const { slow, markMounted } = usePageLoadWatch(hostRef);
  return (
    <>
      <div ref={hostRef} className="page-host">
        <PageErrorBoundary>
          <Suspense fallback={<Loading label="Loading page…" />}>
            <Outlet />
            <PageMounted onMount={markMounted} />
          </Suspense>
        </PageErrorBoundary>
      </div>
      {slow && <PageLoadFallback />}
    </>
  );
}
