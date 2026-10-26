// Settings window of the 3D view (gear button in its header).
import { Gauge, RotateCcw, Scale, Sparkles, Scan } from "lucide-react";
import { Button, Segmented, Switch } from "../../../components/ui";
import { HZ_CHOICES, MODES, resetView3d, setMode, setView3d, useView3d } from "./settings";

export const MODE_OPTIONS = [
  { value: "performance", label: "Performance", short: "Perf", icon: Gauge },
  { value: "balanced", label: "Balanced", short: "Bal", icon: Scale },
  { value: "visuals", label: "Visuals", short: "Vis", icon: Sparkles },
];

const SWATCHES = ["#c9d1ee", "#e6e8ec", "#9aa1ad", "#4b5160", "#f07f13", "#2f6fde"];

function Row({ label, hint, children }) {
  return (
    <div className="v3d-row" title={hint}>
      <span className="v3d-label">{label}</span>
      <div className="v3d-ctl">{children}</div>
    </div>
  );
}

export function ViewSettings({ onFrame }) {
  const s = useView3d();
  const hzIdx = Math.max(0, HZ_CHOICES.findIndex((h) => h >= s.hz));
  return (
    <div className="v3d-settings">
      <div className="popover-section">
        <div className="v3d-head">
          <span className="strong">Visual mode</span>
          {s.mode === "custom" && <span className="v3d-custom">Custom</span>}
        </div>
        <Segmented
          block
          options={MODE_OPTIONS.map((m) => ({ value: m.value, label: m.label, title: MODES[m.value].hint }))}
          value={s.mode}
          onChange={setMode}
          ariaLabel="Visual mode"
        />
        <p className="xs text-muted">{MODES[s.mode]?.hint || "Your own combination of the settings below."}</p>
      </div>

      <div className="popover-section">
        <span className="v3d-sub">Robot</span>
        <Row label="Colour" hint="Colours from the robot description, or one colour for the whole robot">
          <Segmented size="sm" options={[{ value: "model", label: "Model" }, { value: "custom", label: "Custom" }]} value={s.colorMode} onChange={(colorMode) => setView3d({ colorMode })} />
        </Row>
        {s.colorMode === "custom" && (
          <div className="v3d-swatches">
            {SWATCHES.map((c) => (
              <button key={c} type="button" className={s.color === c ? "is-active" : ""} style={{ background: c }} onClick={() => setView3d({ color: c })} title={c} />
            ))}
            <label className="v3d-picker" title="Any colour">
              <input type="color" value={s.color} onChange={(e) => setView3d({ color: e.target.value })} />
            </label>
          </div>
        )}
        <Row label="Shading" hint="Simple is the cheapest; Realistic uses metal-like materials and reflections">
          <Segmented size="sm" options={[{ value: "flat", label: "Simple" }, { value: "shaded", label: "Shaded" }, { value: "realistic", label: "Realistic" }]} value={s.shading} onChange={(shading) => setView3d({ shading })} />
        </Row>
        <Row label="Mesh detail" hint="Meshes are simplified on the robot: Low about 12 % of the triangles, Medium about 35 %, Full all of them">
          <Segmented size="sm" options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "full", label: "Full" }]} value={s.detail} onChange={(detail) => setView3d({ detail })} />
        </Row>
      </div>

      <div className="popover-section">
        <span className="v3d-sub">Lighting</span>
        <Row label="Light" hint="Soft: even light, Studio: key and fill light, Bright: stronger studio light">
          <Segmented size="sm" options={[{ value: "soft", label: "Soft" }, { value: "studio", label: "Studio" }, { value: "bright", label: "Bright" }]} value={s.lighting} onChange={(lighting) => setView3d({ lighting })} />
        </Row>
        <Row label="Brightness">
          <input className="v3d-range" type="range" min="0.5" max="1.6" step="0.05" value={s.brightness} onChange={(e) => setView3d({ brightness: Number(e.target.value) })} />
          <span className="v3d-val">{Math.round(s.brightness * 100)} %</span>
        </Row>
        <Row label="Shadows" hint="Shadow of the robot on the floor (costs the most)">
          <Switch size="sm" checked={s.shadows} onChange={(shadows) => setView3d({ shadows })} />
        </Row>
      </div>

      <div className="popover-section">
        <span className="v3d-sub">Rendering</span>
        <Row label="Max rate" hint="Most frames per second. The view only draws when the robot, the camera or a setting changes; a still robot costs nothing.">
          <input className="v3d-range" type="range" min="0" max={HZ_CHOICES.length - 1} step="1" value={hzIdx} onChange={(e) => setView3d({ hz: HZ_CHOICES[Number(e.target.value)] })} />
          <span className="v3d-val">{s.hz} Hz</span>
        </Row>
        <Row label="Resolution" hint="Drawing at a lower resolution saves a lot on computers without a graphics card">
          <Segmented size="sm" options={[{ value: 0.75, label: "75 %" }, { value: 1, label: "100 %" }, { value: 2, label: "Sharp" }]} value={s.resolution} onChange={(resolution) => setView3d({ resolution })} />
        </Row>
        <Row label="Anti-aliasing" hint="Smooth edges">
          <Switch size="sm" checked={s.antialias} onChange={(antialias) => setView3d({ antialias })} />
        </Row>
        <Row label="Smooth motion" hint="Move smoothly between joint updates (draws a few more frames while the robot moves)">
          <Switch size="sm" checked={s.smooth} onChange={(smooth) => setView3d({ smooth })} />
        </Row>
      </div>

      <div className="popover-section">
        <span className="v3d-sub">Scene</span>
        <div className="v3d-switches">
          <Switch size="sm" label="Grid" checked={s.grid} onChange={(grid) => setView3d({ grid })} />
          <Switch size="sm" label="Floor" checked={s.floor} onChange={(floor) => setView3d({ floor })} />
          <Switch size="sm" label="Base axes" checked={s.axes} onChange={(axes) => setView3d({ axes })} />
          <Switch size="sm" label="Tool frame" checked={s.tcpFrame} onChange={(tcpFrame) => setView3d({ tcpFrame })} />
        </div>
        <Row label="Background">
          <Segmented size="sm" options={[{ value: "", label: "Theme" }, { value: "custom", label: "Custom" }]} value={s.background ? "custom" : ""} onChange={(v) => setView3d({ background: v ? "#1d2026" : "" })} />
          {s.background && (
            <label className="v3d-picker" title="Background colour">
              <input type="color" value={s.background} onChange={(e) => setView3d({ background: e.target.value })} />
            </label>
          )}
        </Row>
        <Row label="Render stats" hint="Frames drawn per second, time per frame and triangles, in the corner of the view">
          <Switch size="sm" checked={s.showStats} onChange={(showStats) => setView3d({ showStats })} />
        </Row>
      </div>

      <div className="v3d-actions">
        <Button size="sm" variant="ghost" icon={Scan} onClick={onFrame}>Fit robot in view</Button>
        <span className="grow" />
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetView3d}>Defaults</Button>
      </div>
    </div>
  );
}
