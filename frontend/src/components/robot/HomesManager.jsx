// Homes of the motion server: list, set active, go to, teach, delete, and
// the homing settings (speed, acceleration, tolerance). Shown in
// Settings › Point teach.
import { useEffect, useState } from "react";
import { Crosshair, Home, Lock, Plus, Settings2, Star, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Segmented, Select, Tabs } from "../ui";
import { robotApi, robotCall } from "../../lib/robotApi";
import { usePoints } from "../../lib/queries";
import { send } from "../../lib/ws";
import { confirm } from "../../store/confirm";
import { useRobot, selectLatched } from "../../store/robot";

const deg = (r) => ((Number(r) * 180) / Math.PI).toFixed(1);
const JOINTS = [0, 1, 2, 3, 4, 5];

function HomeList({ onTeach }) {
  const homes = useRobot((s) => s.homes);
  const atHome = useRobot((s) => s.atHome);
  const latched = useRobot(selectLatched);
  const motionActive = useRobot((s) => s.motion?.active);

  const setActive = (name) => robotCall(() => robotApi.setActiveHome(name));
  const remove = async (name) => {
    if (await confirm({ title: `Delete home "${name}"?`, message: "This removes it from the motion server's homing file.", tone: "danger", confirmLabel: "Delete" }))
      robotCall(() => robotApi.deleteHome(name));
  };

  if (!homes.list.length) {
    return <EmptyState compact icon={Home} title="No homes reported" text="The motion server lists its homes here once it is running." action={<Button icon={Plus} onClick={onTeach}>Teach a home</Button>} />;
  }
  return (
    <div className="home-list">
      {homes.list.map((h) => {
        const isActive = h.name === homes.active;
        const here = atHome?.homeName === h.name;
        return (
          <div key={h.name} className={`home-row ${isActive ? "is-active" : ""}`}>
            <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <strong>{h.name}</strong>
                {isActive && <Badge tone="primary">Active</Badge>}
                {here && <Badge tone="success" dot>Robot is here</Badge>}
                {h.locked && <Lock size={13} className="muted" title="Locked: cannot be changed or deleted" />}
              </div>
              {h.description && <span className="xs muted truncate">{h.description}</span>}
              <span className="xs mono muted">
                {h.joints.map((v, i) => `J${i + 1} ${deg(v)}°`).join("  ")}
              </span>
              {h.stages?.length === 6 && <span className="xs muted">Stages: {h.stages.map((s, i) => `J${i + 1}→${s}`).join(" ")}{h.viaPoint ? ` · via ${h.viaPoint}` : ""}</span>}
            </div>
            <div className="row" style={{ gap: 4 }}>
              {!isActive && <Button size="sm" icon={Star} onClick={() => setActive(h.name)} title="Use this home for the HOME button">Set active</Button>}
              <Button size="sm" icon={Home} disabled={latched || motionActive || here} onClick={() => send("UI_COMMANDS", { command: "home", home: h.name })} title={here ? "The robot is already here" : `Move to ${h.name}`}>Go</Button>
              <IconButton size="sm" icon={Trash2} label="Delete home" disabled={h.locked || isActive} onClick={() => remove(h.name)} title={h.locked ? "Locked" : isActive ? "The active home cannot be deleted" : "Delete"} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeachHome({ onDone }) {
  const { data: points = [] } = usePoints();
  const positions = useRobot((s) => s.positions);
  const homes = useRobot((s) => s.homes);
  const [f, setF] = useState({ name: "", description: "", source: "current", point: "", values: ["0", "0", "0", "0", "0", "0"], useStages: false, stages: [2, 1, 1, 2, 2, 2], setActive: false, overwrite: false });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const exists = homes.list.some((h) => h.name === f.name);

  const submit = async () => {
    setBusy(true);
    const r = await robotCall(() =>
      robotApi.teachHome({
        name: f.name.trim(),
        description: f.description,
        source: f.source,
        point: f.point,
        joints: f.source === "values" ? f.values.map((v) => (Number(v) * Math.PI) / 180) : [],
        stages: f.useStages ? f.stages : [],
        setActive: f.setActive,
        overwrite: f.overwrite,
      })
    );
    setBusy(false);
    if (r?.ok) onDone();
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="form-grid">
        <Field label="Name" hint="Letters, digits, _ and -">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. home_fixture" />
        </Field>
        <Field label="Description">
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Joint values from">
        <Segmented
          block
          value={f.source}
          onChange={(v) => set("source", v)}
          options={[
            { value: "current", label: "Current position", icon: Crosshair },
            { value: "point", label: "A taught point" },
            { value: "values", label: "Typed values" },
          ]}
        />
      </Field>
      {f.source === "current" && <span className="xs mono muted">{positions.map((v, i) => `J${i + 1} ${deg(v)}°`).join("  ")}</span>}
      {f.source === "point" && (
        <Select value={f.point} onChange={(e) => set("point", e.target.value)} placeholder="Choose a point…">
          {points.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </Select>
      )}
      {f.source === "values" && (
        <div className="limits-grid">
          {JOINTS.map((i) => (
            <Field key={i} label={`J${i + 1} (°)`}>
              <Input size="sm" type="number" step="0.1" value={f.values[i]} onChange={(e) => set("values", f.values.map((v, k) => (k === i ? e.target.value : v)))} />
            </Field>
          ))}
        </div>
      )}
      <Checkbox label="Home in stages (joints with a lower stage move first)" checked={f.useStages} onChange={(v) => set("useStages", v)} />
      {f.useStages && (
        <div className="limits-grid">
          {JOINTS.map((i) => (
            <Field key={i} label={`J${i + 1} stage`}>
              <Select size="sm" value={f.stages[i]} onChange={(e) => set("stages", f.stages.map((v, k) => (k === i ? Number(e.target.value) : v)))}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 16 }}>
        <Checkbox label="Make it the active home" checked={f.setActive} onChange={(v) => set("setActive", v)} />
        {exists && <Checkbox label={`Replace the existing "${f.name}"`} checked={f.overwrite} onChange={(v) => set("overwrite", v)} />}
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button variant="primary" icon={Plus} loading={busy} disabled={!f.name.trim() || (f.source === "point" && !f.point) || (exists && !f.overwrite)} onClick={submit}>
          Teach home
        </Button>
      </div>
    </div>
  );
}

const SETTINGS = [
  ["default_speed_mps", "Default speed", "m/s", 0.01],
  ["default_acceleration_mps2", "Default acceleration", "m/s²", 0.05],
  ["max_speed_mps", "Max speed", "m/s", 0.01],
  ["position_tolerance", "Position tolerance", "rad", 0.001],
  ["already_home_tolerance", "\"Already home\" tolerance", "rad", 0.001],
  ["settle_timeout_s", "Settle timeout", "s", 0.5],
];

function HomingSettings() {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    robotApi.homingConfig().then((r) => (r.ok ? setCfg(r.config) : setError(r.message))).catch((e) => setError(e.message));
  }, []);
  if (error) return <Alert tone="warning">{error}</Alert>;
  if (!cfg) return <span className="muted small">Loading…</span>;
  const save = async () => {
    setBusy(true);
    const config = Object.fromEntries(SETTINGS.map(([k]) => [k, Number(cfg[k])]));
    const r = await robotCall(() => robotApi.setHomingConfig(config));
    if (r?.config) setCfg(r.config);
    setBusy(false);
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="form-grid">
        {SETTINGS.map(([k, label, unit, step]) => (
          <Field key={k} label={`${label} (${unit})`}>
            <Input type="number" step={step} min={0} value={cfg[k] ?? ""} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button variant="primary" loading={busy} onClick={save}>Save homing settings</Button>
      </div>
    </div>
  );
}

export function HomesManager({ initialTab = "list" }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <div className="col" style={{ gap: 0 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "list", label: "Homes", icon: Home },
          { value: "teach", label: "Teach a home", icon: Plus },
          { value: "settings", label: "Homing settings", icon: Settings2 },
        ]}
      />
      <div style={{ paddingTop: 14 }}>
        {tab === "list" && <HomeList onTeach={() => setTab("teach")} />}
        {tab === "teach" && <TeachHome onDone={() => setTab("list")} />}
        {tab === "settings" && <HomingSettings />}
      </div>
    </div>
  );
}
