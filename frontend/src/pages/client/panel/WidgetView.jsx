// One operator-panel widget as the operator uses it. Everything that acts goes through act():
// the interlock first (widgets that need the robot stopped show "Stop the robot first" while the
// program runs or the robot moves; stopping / reset actions never wait), then the optional
// confirmation, then the call, with the answer as a toast.
import { useEffect, useRef, useState } from "react";
import { Button, Input, Segmented, Select, StatusDot, Switch, cx } from "../../../components/ui";
import { errorMessage } from "../../../lib/api";
import { guardIdle } from "../../../lib/interlock";
import { plainText } from "../../../lib/plainText";
import { confirm } from "../../../store/confirm";
import { toast } from "../../../store/toast";
import { useDiList, useDoList } from "../../../lib/queries";
import { plcNameOfPin, plcUseText, usePlcIoUsage } from "../../../lib/plcIoUsage";
import { MODES, publishSpeedScale, speedForSettings, updateSettings } from "../clientState";
import {
  SETTING_KEYS, actionById, ioLabel, isPlcRegister, isSafeWrite, robotKey, truthy, useBindingValue, writeBinding, writable,
} from "./bindings";

/** Interlock, confirmation, call, toast. `safe` = a stop / reset kind of action. */
export async function act(widget, { safe = false, confirmDefault = false, what }, fn) {
  const needsIdle = widget.guard !== false && !safe;
  if (needsIdle && !guardIdle(`use “${widget.label || "this control"}”`)) return false;
  const ask = widget.confirm ?? confirmDefault;
  if (ask && !(await confirm({ title: widget.label || "Confirm", message: `${what || "Run this action"}?`, confirmLabel: "Yes", tone: "warning" }))) return false;
  try {
    const msg = await fn();
    if (msg && widget.feedback !== false) toast.success(plainText(msg));
    return true;
  } catch (err) {
    if (err?.code !== "ROBOT_BUSY") toast.error(plainText(errorMessage(err, "Could not do that")));
    return false;
  }
}

/** Options of a radio / dropdown widget. */
export function optionsOf(w) {
  const b = w.binding || {};
  if (b.kind === "setting") return SETTING_KEYS[b.key]?.options || [];
  if (b.kind === "robot") return robotKey(b.key)?.options || [];
  return (w.options || []).map((o) => ({ value: String(o.value), label: o.label || String(o.value) }));
}

const fmt = (v, w) => {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? w.onText || "ON" : w.offText || "OFF";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(w.decimals ?? 2);
  const n = Number(v);
  if (w.decimals !== undefined && v !== "" && Number.isFinite(n)) return n.toFixed(w.decimals);
  return String(v);
};

function Head({ w, children }) {
  if (!w.label && !children) return null;
  return (
    <div className="op-head">
      <span className="op-title truncate" title={w.label}>{w.label}</span>
      {children}
    </div>
  );
}

function ButtonWidget({ w }) {
  const b = w.binding || {};
  const live = useBindingValue(b);
  const action = b.kind === "action" ? actionById(b.action) : null;
  const mode = b.mode || (b.kind === "topic" ? "send" : isPlcRegister(b.name) ? "send" : "pulse");
  const lit = b.kind !== "action" && live.known && truthy(live.value);
  const press = (down) => {
    if (mode !== "momentary") return;
    act(w, { safe: !down }, () => writeBinding(b, down, { io: live.io }));
  };
  const click = () => {
    if (mode === "momentary") return;
    if (action) return act(w, { safe: action.safe, confirmDefault: action.confirm, what: action.label }, () => action.run(b.arg));
    if (!b.kind) return toast.info("Edit the panel to give this button a function");
    let value = true;
    let pulseMs = 0;
    if (mode === "pulse") pulseMs = Number(b.pulse_ms) || 300;
    else if (mode === "reset") value = false;
    else if (mode === "toggle") value = !truthy(live.value);
    else if (mode === "send") value = b.value ?? "";
    return act(w, { safe: mode === "reset", what: w.label }, () => writeBinding(b, value, { pulseMs, guard: w.guard !== false, io: live.io }));
  };
  return (
    <button
      type="button"
      className={cx("op-button", lit && "is-lit")}
      onClick={click}
      onPointerDown={() => press(true)}
      onPointerUp={() => press(false)}
      onPointerLeave={(e) => e.buttons && press(false)}
      title={action ? action.label : w.hint || w.label}
    >
      <span className="op-button-label">{w.label || action?.label || "Button"}</span>
      {w.h > 1 && w.sub !== "" && <span className="op-button-sub">{w.sub || (action ? action.group : mode === "momentary" ? "hold" : mode === "pulse" ? "pulse" : mode)}</span>}
      {b.kind && b.kind !== "action" && live.known && <span className={cx("op-button-led", lit && "on")} />}
    </button>
  );
}

function ToggleWidget({ w }) {
  const b = w.binding || {};
  const live = useBindingValue(b);
  const [pending, setPending] = useState(null);
  useEffect(() => { if (pending !== null && truthy(live.value) === pending) setPending(null); }, [live.value, pending]);
  useEffect(() => { if (pending === null) return undefined; const t = setTimeout(() => setPending(null), 2500); return () => clearTimeout(t); }, [pending]);
  const on = pending ?? (live.known && truthy(live.value));
  const change = (next) => act(w, { safe: isSafeWrite(b, next), what: `${next ? "Switch on" : "Switch off"} ${w.label || ""}` }, async () => { setPending(next); return writeBinding(b, next, { guard: w.guard !== false, io: live.io }); });
  return (
    <div className="op-toggle">
      <span className="op-title truncate" title={w.label}>{w.label || "Toggle"}</span>
      <span className={cx("op-state", on && "is-on")}>{live.known || pending !== null ? (on ? w.onText || "ON" : w.offText || "OFF") : "—"}</span>
      <Switch checked={on} tone="success" onChange={change} disabled={!writable(b)} title={writable(b) ? "" : "Read only"} />
    </div>
  );
}

function IndicatorWidget({ w }) {
  const live = useBindingValue(w.binding || {});
  let on = live.known && truthy(live.value);
  if (w.invert) on = !on && live.known;
  return (
    <div className={cx("op-indicator", on && "is-on", on && w.blink && "is-blink")}>
      <span className="op-lamp" />
      <span className="op-title truncate grow" title={w.label}>{w.label || "Indicator"}</span>
      <span className={cx("op-state", on && "is-on")}>{live.known ? (on ? w.onText || "ON" : w.offText || "OFF") : "—"}</span>
    </div>
  );
}

function SpeedScale({ settings }) {
  const [draft, setDraft] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const high = settings?.mode === "high_testing";
  const speed = draft ?? speedForSettings(settings);
  const change = (v) => {
    setDraft(v);
    publishSpeedScale(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => updateSettings({ speed: v }).finally(() => setDraft(null)), 400);
  };
  return (
    <div className="op-scale" data-tut="cc-speedscale" title={high ? "Speed scale for high speed test" : MODES[settings?.mode]?.hint || ""}>
      <span className="xs muted">Speed scale</span>
      <b className="tabular small">{Number(speed).toFixed(2)}</b>
      <input type="range" className="cc-range" min={0.5} max={0.9} step={0.01} value={high ? speed : 0.5} style={{ "--fill": `${high ? ((speed - 0.5) / 0.4) * 100 : 0}%` }} disabled={!high} aria-label="Speed scale" onChange={(e) => change(parseFloat(e.target.value))} />
    </div>
  );
}

function ChoiceWidget({ w, dropdown }) {
  const b = w.binding || {};
  const live = useBindingValue(b);
  const options = optionsOf(w);
  const value = live.known ? String(live.value) : "";
  const choose = (v) => {
    const opt = options.find((o) => String(o.value) === String(v));
    return act(w, { safe: false, what: `Switch to ${opt?.label || v}` }, () => writeBinding(b, b.kind === "plc" ? Number(v) : v, { guard: w.guard !== false }));
  };
  const runMode = b.kind === "setting" && b.key === "mode";
  return (
    <div className="op-choice">
      <Head w={w} />
      {dropdown ? (
        <Select value={value} onChange={(e) => choose(e.target.value)} options={options} placeholder={live.known ? undefined : "—"} disabled={!writable(b)} />
      ) : (
        <Segmented block value={value} onChange={choose} options={options.map((o) => ({ ...o, value: String(o.value) }))} ariaLabel={w.label} disabled={!writable(b)} />
      )}
      {runMode && w.h > 1 && <SpeedScaleHost />}
    </div>
  );
}
function SpeedScaleHost() {
  const live = useBindingValue({ kind: "setting", key: "speed" });
  const mode = useBindingValue({ kind: "setting", key: "mode" });
  return <SpeedScale settings={{ mode: mode.value, speed: live.value }} />;
}

function NumberWidget({ w, slider }) {
  const b = w.binding || {};
  const live = useBindingValue(b);
  const rk = b.kind === "robot" ? robotKey(b.key) : null;
  const min = Number(w.min ?? rk?.min ?? 0);
  const max = Number(w.max ?? rk?.max ?? 100);
  const step = Number(w.step ?? (b.type === "float" ? 0.1 : 1));
  const [draft, setDraft] = useState(null);
  const cur = draft ?? (live.known ? Number(live.value) : min);
  const send = (v) => act(w, { safe: isSafeWrite(b, v), what: `Set ${w.label || "the value"} to ${v}` }, () => writeBinding(b, v, { guard: w.guard !== false })).finally(() => setDraft(null));
  if (slider) {
    const live2 = b.kind === "robot" && b.key === "speed"; // the override follows the slider at once
    return (
      <div className="op-number">
        <Head w={w}><b className="tabular op-num-value">{fmt(cur, w)}{w.unit ? <small> {w.unit}</small> : null}</b></Head>
        <input
          type="range" className="cc-range" min={min} max={max} step={step} value={Number.isFinite(cur) ? cur : min}
          style={{ "--fill": `${((cur - min) / (max - min || 1)) * 100}%` }} disabled={!writable(b)} aria-label={w.label}
          onChange={(e) => { const v = Number(e.target.value); setDraft(v); if (live2) writeBinding(b, v).catch(() => {}); }}
          onPointerUp={(e) => !live2 && send(Number(e.currentTarget.value))}
          onKeyUp={(e) => !live2 && send(Number(e.currentTarget.value))}
        />
      </div>
    );
  }
  return (
    <form className="op-number op-inline" onSubmit={(e) => { e.preventDefault(); if (draft !== null && draft !== "") send(Number(draft)); }}>
      <span className="op-title truncate" title={w.label}>{w.label || "Value"}</span>
      <Input size="sm" type="number" min={w.min} max={w.max} step={step} value={draft ?? ""} placeholder={live.known ? fmt(live.value, w) : "—"} onChange={(e) => setDraft(e.target.value)} disabled={!writable(b)} />
      {w.unit && <span className="xs muted">{w.unit}</span>}
      <Button size="sm" type="submit" disabled={draft === null || draft === ""}>Set</Button>
    </form>
  );
}

function TextWidget({ w }) {
  const b = w.binding || {};
  const live = useBindingValue(b);
  const [draft, setDraft] = useState("");
  return (
    <form className="op-number op-inline" onSubmit={(e) => { e.preventDefault(); act(w, { what: `Send “${draft}”` }, () => writeBinding(b, draft, { guard: w.guard !== false })).then((sent) => sent && setDraft("")); }}>
      <span className="op-title truncate" title={w.label}>{w.label || "Text"}</span>
      <Input size="sm" value={draft} placeholder={live.known ? String(live.value) : "Type a text"} onChange={(e) => setDraft(e.target.value)} />
      <Button size="sm" type="submit">Send</Button>
    </form>
  );
}

function DisplayWidget({ w }) {
  const live = useBindingValue(w.binding || {});
  return (
    <div className="op-display">
      <span className="op-title truncate" title={w.label}>{w.label || "Value"}</span>
      <span className="op-display-value tabular truncate">{fmt(live.value, w)}{w.unit && live.known ? <small> {w.unit}</small> : null}</span>
    </div>
  );
}

/** Small "PLC" tag when the PLC program uses the signal this binding switches or shows. */
function PlcTag({ io, className }) {
  const usage = usePlcIoUsage();
  const u = io ? usage[plcNameOfPin(io.device, io.pin)] : null;
  if (!u) return null;
  return <span className={cx("op-plc-tag", u.driven && "is-driven", className)} title={plcUseText(u)}>PLC</span>;
}

function GroupItem({ w, item, output }) {
  const live = useBindingValue(item.binding);
  const on = live.known && truthy(live.value);
  const push = item.push || item.binding?.item?.type_of_control === "push";
  if (!output) {
    return (
      <div className="cc-io-tile op-gitem" title={item.label}>
        <StatusDot tone={on ? "success" : "off"} size="lg" />
        <span className="truncate">{item.label}</span>
        <PlcTag io={live.io} />
        <span className={on ? "cc-io-state is-on" : "cc-io-state"}>{live.known ? (on ? "ON" : "OFF") : "—"}</span>
      </div>
    );
  }
  const set = (v, pulseMs = 0) => act(w, { safe: !v, what: `${v ? "Switch on" : "Switch off"} ${item.label}` }, () => writeBinding(item.binding, v, { pulseMs, guard: w.guard !== false, io: live.io }));
  return (
    <div className="cc-io-tile op-gitem" title={item.label}>
      <span className="truncate grow">{item.label}</span>
      <PlcTag io={live.io} />
      {push ? <Button size="sm" onClick={() => set(true, Number(item.pulse_ms) || 250)}>Push</Button> : <Switch checked={on} tone="success" onChange={(v) => set(v)} />}
    </div>
  );
}

function GroupWidget({ w }) {
  const b = w.binding || {};
  const di = useDiList();
  const dout = useDoList();
  const output = b.dir === "do";
  let items = b.items || [];
  if (b.source === "iolist") {
    const list = (output ? dout.data : di.data) || [];
    items = list.map((it) => ({ label: ioLabel(it.name), binding: { kind: "iolist", dir: b.dir, name: it.name, item: it }, push: it.type_of_control === "push", pulse_ms: parseInt(it.push_wait, 10) || 250 }));
  }
  const loading = b.source === "iolist" && (output ? dout.isLoading : di.isLoading);
  return (
    <div className="op-group">
      <Head w={w}><span className="xs muted">{items.length} signal{items.length === 1 ? "" : "s"}</span></Head>
      <div className="op-group-grid">
        {items.map((it, i) => <GroupItem key={`${it.label}-${i}`} w={w} item={it} output={output} />)}
        {!items.length && <div className="op-empty">{loading ? "Loading…" : b.source === "iolist" ? `No ${output ? "outputs" : "inputs"} in the IO list yet (IO Control page)` : "No signals yet: edit the panel to add some"}</div>}
      </div>
    </div>
  );
}

function LabelWidget({ w }) {
  return (
    <div className={cx("op-label", `is-${w.textSize || "sm"}`, w.caps === false && "is-normal")}>
      <span className="op-label-text">{w.label || "Heading"}</span>
      {w.note && <span className="xs muted truncate">{w.note}</span>}
    </div>
  );
}

const VIEWS = {
  button: ButtonWidget,
  toggle: ToggleWidget,
  indicator: IndicatorWidget,
  radio: (p) => <ChoiceWidget {...p} />,
  dropdown: (p) => <ChoiceWidget {...p} dropdown />,
  number: (p) => <NumberWidget {...p} />,
  slider: (p) => <NumberWidget {...p} slider />,
  text: TextWidget,
  display: DisplayWidget,
  group: GroupWidget,
  label: LabelWidget,
};

/** Tag in the widget's corner for a single IO binding (groups tag each signal). */
function WidgetPlcTag({ b }) {
  const live = useBindingValue(b);
  return <PlcTag io={live.io} className="is-corner" />;
}

export default function WidgetView({ w }) {
  const View = VIEWS[w.type] || DisplayWidget;
  const b = w.binding;
  return (
    <>
      <View w={w} />
      {(b?.kind === "io" || b?.kind === "iolist") && w.type !== "group" && <WidgetPlcTag b={b} />}
    </>
  );
}

