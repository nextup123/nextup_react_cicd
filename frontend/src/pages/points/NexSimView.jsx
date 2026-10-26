// 3D robot view of the Teach Points page.
//
// The view lives in one persistent element (`host`) that is moved between
// the docked column and the floating window, so docking and undocking never
// reload the robot. The renderer (viewer3d/RobotViewer.js) draws only when
// something changes and stops while the view is hidden; the robot model is
// chosen in the header (any description in the robot's urdf folder) and the
// visual mode and settings sit next to it. While it is shown, hovering a jog
// button previews that motion (arrows or ghost robot). The pose follows the
// app's live JOINT_STATES.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, ChevronDown, ChevronUp, GripHorizontal, MapPin, Maximize2, Minimize2, MoveDiagonal2, Settings2, X } from "lucide-react";
import { IconButton, Select, cx } from "../../components/ui";
import { useRobot } from "../../store/robot";
import { useNexSim } from "./nexsimStore";
import { themeVar, useTheme } from "../../lib/theme";
import { setMode, setView3d, useView3d } from "./viewer3d/settings";
import { MODE_OPTIONS, ViewSettings } from "./viewer3d/ViewSettings";
import { chooseModel, refreshModels, useRobotModels, wireModelUpdates } from "./viewer3d/models";
import { toast } from "../../store/toast";
import { importRetry } from "../../lib/retry";

const MIN_W = 320;
const MIN_H = 240;

const sceneColors = () => ({
  bg: themeVar("--scene3d-bg"),
  floor: themeVar("--scene3d-floor"),
  grid: themeVar("--scene3d-grid"),
  center: themeVar("--primary-500"),
});

/** Creates the viewer in a detached element for the lifetime of the page. */
export function useNexSimViewer(points = [], currentPoint = null) {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "pp-nxs-host";
    return el;
  });
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [jogMode, setJogModeState] = useState("arrows");
  const [stats, setStats] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const model = useRobotModels((s) => s.model);
  const modelError = useRobotModels((s) => s.error);
  const settings = useView3d();

  useEffect(() => {
    let cancelled = false;
    let viewer = null;
    wireModelUpdates();
    refreshModels();
    importRetry(() => import("./viewer3d/RobotViewer"))()
      .then(({ RobotViewer }) => {
        if (cancelled) return;
        viewer = new RobotViewer(host, {
          settings: useView3d.getState(),
          colors: sceneColors(),
          onStats: setStats,
          onError: (msg) => setError(msg),
        });
        viewer.setJogFrame(useRobot.getState().servoFrame);
        viewer.setJoints(useRobot.getState().positions);
        useNexSim.setState({ open: true, viewer });
        const m = useRobotModels.getState().model;
        if (m) viewer.setModel(m);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err.message || "The 3D view could not start (WebGL not available?)");
      });

    const unsub = useRobot.subscribe((s, prev) => {
      if (!viewer) return;
      if (s.positions !== prev.positions) viewer.setJoints(s.positions);
      if (s.servoFrame !== prev.servoFrame) viewer.setJogFrame(s.servoFrame);
    });

    return () => {
      cancelled = true;
      unsub();
      useNexSim.setState({ open: false, viewer: null });
      if (viewer) {
        try {
          viewer.dispose();
        } catch (err) {
          console.warn("[3d] dispose failed", err);
        }
      }
      host.replaceChildren();
    };
  }, [host]);

  // Model, settings and theme changes go to the running viewer.
  useEffect(() => {
    const v = useNexSim.getState().viewer;
    if (status === "ready" && v && model && v.model !== model) {
      v.setModel(model);
      v.setJoints(useRobot.getState().positions);
    }
  }, [model, status]);
  useEffect(() => {
    const v = useNexSim.getState().viewer;
    if (status === "ready" && v) v.setSettings(settings);
    if (!settings.showStats) setStats(null);
  }, [settings, status]);
  const theme = useTheme();
  useEffect(() => {
    if (status !== "ready") return undefined;
    // After the CSS of the new theme is applied.
    const t = requestAnimationFrame(() => useNexSim.getState().viewer?.setColors(sceneColors()));
    return () => cancelAnimationFrame(t);
  }, [theme, status]);

  // Teach points as balls with names (positions from the joints, see RobotViewer.setPoints).
  useEffect(() => {
    const v = useNexSim.getState().viewer;
    if (status !== "ready" || !v) return;
    v.setPoints(
      points.map((p) => {
        const jv = p.joints_values || {};
        const joints = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"].map((k) => Number(jv[k]));
        const c = p.coordinate || {};
        const xyz = [c.x, c.y, c.z].every((n) => Number.isFinite(Number(n))) ? [c.x / 100, c.y / 100, c.z / 100].map(Number) : null;
        return { name: p.name, joints: joints.every(Number.isFinite) ? joints : null, xyz };
      }),
      currentPoint
    );
  }, [points, currentPoint, status, model]);

  const toggleJogMode = () => {
    const viewer = useNexSim.getState().viewer;
    if (!viewer) return;
    const next = jogMode === "arrows" ? "ghost" : "arrows";
    viewer.setJogMode(next);
    setJogModeState(next);
  };
  const frame = () => useNexSim.getState().viewer?.frame();

  return { host, status, error: error || (!model ? modelError : null), jogMode, toggleJogMode, stats, frame, settingsOpen, setSettingsOpen };
}

/** Moves the shared viewer element into this slot while it is mounted. */
const PANEL_KEY = "nextup.view3d.panel";
const readPanelPos = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PANEL_KEY) || "null");
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
};

/**
 * The settings window inside the view. Drag it by its title to move it off
 * the robot; the position is remembered (saved on the robot with the layout).
 */
function SettingsPanel({ nx, mountRef }) {
  const [pos, setPos] = useState(readPanelPos);
  const [folded, setFolded] = useState(false);
  const panelRef = useRef(null);
  const drag = useRef(null);
  const clamp = (x, y) => {
    const m = mountRef.current?.getBoundingClientRect();
    const r = panelRef.current?.getBoundingClientRect();
    if (!m || !r) return { x, y };
    return { x: Math.min(Math.max(0, x), Math.max(0, m.width - r.width)), y: Math.min(Math.max(0, y), Math.max(0, m.height - 40)) };
  };
  // Keep it inside the view when the view gets smaller.
  useEffect(() => {
    if (!pos) return undefined;
    const fix = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    const ro = new ResizeObserver(fix);
    if (mountRef.current) ro.observe(mountRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(pos)]);
  const down = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const m = mountRef.current.getBoundingClientRect();
    const r = panelRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, mx: m.left, my: m.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    setPos(clamp(e.clientX - d.mx - d.dx, e.clientY - d.my - d.dy));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    setPos((p) => {
      try {
        if (p) localStorage.setItem(PANEL_KEY, JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }));
      } catch {
        /* ignore */
      }
      return p;
    });
  };
  const style = pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined;
  return (
    <aside ref={panelRef} className={cx("v3d-panel", folded && "is-folded")} style={style} aria-label="3D view settings" onKeyDown={(e) => e.key === "Escape" && nx.setSettingsOpen(false)}>
      <div className="v3d-panel-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Drag to move this window">
        <GripHorizontal size={15} className="pp-nxs-grip" />
        <Settings2 size={15} />
        <span className="strong grow">3D view settings</span>
        <IconButton icon={folded ? ChevronDown : ChevronUp} label={folded ? "Unfold the settings" : "Fold the settings to their title bar"} size="sm" onClick={() => setFolded((f) => !f)} />
        <IconButton icon={X} label="Close the settings" size="sm" onClick={() => nx.setSettingsOpen(false)} />
      </div>
      {!folded && <ViewSettings onFrame={nx.frame} />}
    </aside>
  );
}

function ViewerSlot({ nx }) {
  const ref = useRef(null);
  const loadingModel = useRobotModels((s) => s.loading);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (!slot) return undefined;
    slot.prepend(nx.host);
    return () => {
      if (nx.host.parentNode === slot) slot.removeChild(nx.host);
    };
  }, [nx.host]);
  const st = nx.stats;
  return (
    <div className="pp-nxs-mount" ref={ref}>
      {nx.status === "loading" && <div className="pp-nxs-overlay">Loading 3D view…</div>}
      {nx.status === "error" && <div className="pp-nxs-overlay text-danger">{nx.error}</div>}
      {nx.status === "ready" && nx.error && <div className="pp-nxs-note text-danger xs">{nx.error}</div>}
      {nx.status === "ready" && loadingModel && <div className="pp-nxs-note xs">Loading robot model…</div>}
      {st && (
        <div className="pp-nxs-stats xs" title="Frames drawn in the last second · average time per frame · triangles drawn">
          {st.paused ? "paused (hidden)" : st.fps ? `${st.fps} fps · ${st.ms.toFixed(1)} ms · ${Math.round(st.triangles / 1000)}k tris` : `idle: nothing to redraw · ${Math.round(st.triangles / 1000)}k tris`}
        </div>
      )}
      <div className="pp-nxs-hint xs">Hover a jog button to preview · drag to rotate · right-drag to pan · wheel to zoom</div>
      {nx.settingsOpen && <SettingsPanel nx={nx} mountRef={ref} />}
    </div>
  );
}

function PreviewButton({ nx }) {
  return (
    <button type="button" className="v3d-chip" onClick={nx.toggleJogMode} disabled={nx.status !== "ready"} title="How a jog preview is shown when you hover a jog button">
      Preview: {nx.jogMode === "arrows" ? "arrows" : "ghost"}
    </button>
  );
}

/** Robot model list: every description in the robot's urdf folder. */
function ModelSelect() {
  const { list, selected, rosModel } = useRobotModels();
  const onChange = async (e) => {
    const id = e.target.value;
    const label = list.find((m) => m.id === id)?.label || id;
    if (await chooseModel(id)) toast.success(`3D view and simulator now use ${label}`);
    else toast.error(useRobotModels.getState().error || "Could not switch the robot model");
  };
  return (
    <Select
      size="sm"
      className="v3d-model"
      value={selected || ""}
      onChange={onChange}
      onFocus={refreshModels}
      title="Robot model shown in the 3D view. The one marked (ROS) is the model the robot itself uses."
      disabled={!list.length}
    >
      {!list.length && <option value="">No models</option>}
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
          {m.id === rosModel ? " (ROS)" : ""}
        </option>
      ))}
    </Select>
  );
}

function ModeSwitch() {
  const mode = useView3d((s) => s.mode);
  return (
    <div className="v3d-modes" role="tablist" aria-label="Visual mode">
      {MODE_OPTIONS.map((m) => (
        <button key={m.value} type="button" role="tab" aria-selected={mode === m.value} className={cx(mode === m.value && "is-active")} onClick={() => setMode(m.value)} title={`${m.label} mode`}>
          <m.icon size={14} />
          <span className="v3d-mode-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}

function SettingsButton({ nx }) {
  return (
    <IconButton
      icon={Settings2}
      label="3D view settings: colour, lighting, rate, quality"
      size="sm"
      variant={nx.settingsOpen ? "soft" : "ghost"}
      aria-pressed={nx.settingsOpen}
      onClick={() => nx.setSettingsOpen((o) => !o)}
    />
  );
}

/** Shows or hides the teach points in the scene. */
function PointsToggle() {
  const on = useView3d((s) => s.points !== false);
  return (
    <button
      type="button"
      className={cx("v3d-pts", on && "is-on")}
      aria-pressed={on}
      onClick={() => setView3d({ points: !on })}
      title={on ? "Hide the teach points in the 3D view" : "Show the teach points in the 3D view (balls with their names)"}
    >
      <MapPin size={14} />
      <span>Points</span>
      <span className="v3d-pts-state">{on ? "on" : "off"}</span>
    </button>
  );
}

function Toolbar({ nx }) {
  return (
    <div className="v3d-toolbar">
      <ModeSwitch />
      <span className="grow" />
      <PreviewButton nx={nx} />
      <SettingsButton nx={nx} />
    </div>
  );
}

/** The 3D view as a column of the page. */
export function NexSimDocked({ nx, onDetach }) {
  return (
    <section className="card pp-nxs-card">
      <header className="card-header pp-nxs-head">
        <div className="card-title">
          <Box size={18} />
          <span className="truncate">3D view</span>
        </div>
        <span className="v3d-sep" />
        <ModelSelect />
        <PointsToggle />
        <div className="card-actions">
          <IconButton icon={Maximize2} label="Detach the 3D view into a floating window" size="sm" onClick={onDetach} />
        </div>
      </header>
      <Toolbar nx={nx} />
      <ViewerSlot nx={nx} />
    </section>
  );
}

/** What is left of the column while the 3D view floats: a drop target. */
export const NexSimDropZone = ({ active, over, onAttach, zoneRef }) => (
  <button
    ref={zoneRef}
    type="button"
    className={cx("pp-nxs-drop", active && "is-active", over && "is-over")}
    onClick={onAttach}
    title="Attach the 3D view here (or drag its window onto this strip)"
  >
    <Box size={18} />
    <span className="pp-nxs-drop-text">{over ? "Release to attach" : "Drag the 3D view here to attach"}</span>
  </button>
);

function clampGeom(g) {
  const maxW = Math.max(MIN_W, window.innerWidth - 16);
  const maxH = Math.max(MIN_H, window.innerHeight - 16);
  const width = Math.min(Math.max(MIN_W, g.width), maxW);
  const height = Math.min(Math.max(MIN_H, g.height), maxH);
  return {
    width,
    height,
    left: Math.min(Math.max(g.left, -width + 120), window.innerWidth - 120),
    top: Math.min(Math.max(g.top, 0), window.innerHeight - 44),
  };
}

export function defaultFloatGeom() {
  const width = Math.max(MIN_W, Math.round(window.innerWidth * 0.36));
  const height = Math.max(MIN_H, Math.round(window.innerHeight * 0.6));
  return { left: Math.max(0, window.innerWidth - width - 32), top: 96, width, height };
}

/**
 * The 3D view in a floating window. Drag the title bar to move it; dropping
 * it on the drop zone (zoneRef) docks it again.
 */
export function NexSimFloating({ nx, geom, onGeom, onAttach, zoneRef, onOverZone }) {
  const op = useRef(null);
  const [g, setG] = useState(() => clampGeom(geom || defaultFloatGeom()));

  useEffect(() => {
    const onResize = () => setG((cur) => clampGeom(cur));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const overZone = (x, y) => {
    const r = zoneRef.current?.getBoundingClientRect();
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  };

  const begin = (e, kind) => {
    if (e.button !== 0 || e.target.closest("button, select, input")) return;
    e.preventDefault();
    op.current = { kind, x: e.clientX, y: e.clientY, g: { ...g }, over: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const o = op.current;
    if (!o) return;
    const dx = e.clientX - o.x;
    const dy = e.clientY - o.y;
    const n = { ...o.g };
    if (o.kind === "move") {
      n.left = o.g.left + dx;
      n.top = o.g.top + dy;
      const over = overZone(e.clientX, e.clientY);
      if (over !== o.over) {
        o.over = over;
        onOverZone(over);
      }
    } else {
      if (o.kind.includes("e")) n.width = o.g.width + dx;
      if (o.kind.includes("s")) n.height = o.g.height + dy;
      if (o.kind.includes("w")) {
        n.width = Math.max(MIN_W, o.g.width - dx);
        n.left = o.g.left + (o.g.width - n.width);
      }
    }
    o.last = clampGeom(n);
    setG(o.last);
  };
  const end = (e) => {
    const o = op.current;
    if (!o) return;
    op.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (o.kind === "move" && o.over) {
      onOverZone(false);
      onAttach();
      return;
    }
    if (o.last) onGeom(o.last);
  };
  const handle = (kind) => ({ onPointerDown: (e) => begin(e, kind), onPointerMove: move, onPointerUp: end, onPointerCancel: end });

  return createPortal(
    <div className="pp-nxs-float" style={{ left: g.left, top: g.top, width: g.width, height: g.height }} role="dialog" aria-label="3D view">
      <div className="pp-nxs-bar" {...handle("move")} title="Drag to move · drop on the strip in the page to attach">
        <GripHorizontal size={16} className="pp-nxs-grip" />
        <Box size={16} className="pp-nxs-icon" />
        <span className="strong">3D view</span>
        <span className="v3d-sep" />
        <ModelSelect />
        <PointsToggle />
        <span className="grow" />
        <IconButton icon={Minimize2} label="Attach the 3D view to the page" size="sm" onClick={onAttach} />
      </div>
      <Toolbar nx={nx} />
      <ViewerSlot nx={nx} />
      <div className="pp-nxs-rz is-e" {...handle("e")} />
      <div className="pp-nxs-rz is-w" {...handle("w")} />
      <div className="pp-nxs-rz is-s" {...handle("s")} />
      <div className="pp-nxs-rz is-se" {...handle("se")}>
        <MoveDiagonal2 size={12} />
      </div>
      <div className="pp-nxs-rz is-sw" {...handle("sw")} />
    </div>,
    document.body
  );
}
