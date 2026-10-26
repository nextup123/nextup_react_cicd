// Widget settings: what it shows, what it is wired to, colour, size, safety.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Field, Input, Modal, Segmented, Select, cx } from "../../../components/ui";
import { robotApi } from "../../../lib/robotApi";
import { useDiList, useDoList } from "../../../lib/queries";
import { useRobot } from "../../../store/robot";
import { usePlc } from "../../nextplc/store/plc";
import { I_NAMES, Q_NAMES, M_NAMES, R_NAMES, S_NAMES, S_HELP } from "../../nextplc/lib/addresses";
import { plcApi } from "../../nextplc/lib/api";
import { Combobox } from "../../../components/ui/Combobox";
import { COLORS, WIDGETS } from "./panelModel";
import {
  ACTIONS, BINDING_KINDS, IO_DEVICES, ROBOT_KEYS, SETTING_KEYS, TOPIC_TYPES, actionById, ioLabel, ioPins, isPlcRegister, useTopicList,
} from "./bindings";

const HEADING_SIZES = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra large" },
];
const BOOL_TYPES = new Set(["toggle", "indicator"]);
const NUM_TYPES = new Set(["number", "slider"]);
const CHOICE_TYPES = new Set(["radio", "dropdown"]);

/** Robot states that fit a widget type. */
function robotKeysFor(type) {
  return ROBOT_KEYS.filter((k) => {
    if (type === "toggle") return k.type === "bool" && k.writable;
    if (type === "indicator") return k.type === "bool";
    if (CHOICE_TYPES.has(type)) return k.type === "enum";
    if (NUM_TYPES.has(type)) return k.type === "number" && k.writable;
    return true;
  });
}

/** Suggestions for a PLC address: the program's names first, then the memory map. */
function usePlcOptions(type) {
  const live = usePlc((s) => s.state?.aliases);
  const status = useQuery({ queryKey: ["plc", "status", "aliases"], queryFn: () => plcApi.status(), enabled: !live, staleTime: 30_000, retry: 0 });
  const aliases = live || status.data?.state?.aliases || [];
  return useMemo(() => {
    const g = (group, names, hint) => names.map((n) => ({ value: n, group, hint: hint?.(n) }));
    const named = aliases.map((a) => ({ value: a.alias, group: "Names in the program", hint: a.target }));
    const mem = g("Memory bits (can be set)", M_NAMES);
    const regs = g("Registers (numbers, can be set)", R_NAMES);
    const io = [...g("Inputs (shown only)", I_NAMES), ...g("Outputs (shown only)", Q_NAMES)];
    const sys = g("System bits (shown only)", S_NAMES, (n) => S_HELP[n]);
    return NUM_TYPES.has(type) ? [...named, ...regs, ...mem, ...io, ...sys] : [...named, ...mem, ...regs, ...io, ...sys];
  }, [aliases, type]);
}

/** Editor for one binding (also used for each signal of a group). */
export function BindingFields({ type, b, onChange, compact }) {
  const set = (patch) => onChange({ ...b, ...patch });
  const kinds = (WIDGETS[type]?.kinds || []).filter((k) => k !== "group");
  const di = useDiList();
  const dout = useDoList();
  const topics = useTopicList(b.kind === "topic");
  const boards = useRobot((s) => s.btBlackboard);
  const bbKeys = useMemo(() => [...new Set(Object.values(boards || {}).flat().map((e) => e.key))], [boards]);
  const programs = useQuery({ queryKey: ["robot", "programs", "names"], queryFn: () => robotApi.programs(), enabled: b.kind === "action" && actionById(b.action)?.arg === "program", staleTime: 30_000 });
  const programNames = (programs.data?.programs || []).map((p) => p.name || p).filter(Boolean);
  const plcOptions = usePlcOptions(type);

  return (
    <div className={cx("op-bind", compact && "is-compact")}>
      <Field label="Wired to">
        <Select value={b.kind || ""} onChange={(e) => onChange({ kind: e.target.value })} placeholder="Choose…" options={kinds.map((k) => ({ value: k, label: BINDING_KINDS[k] }))} />
      </Field>

      {b.kind === "action" && (
        <>
          <Field label="Action">
            <Select value={b.action || ""} onChange={(e) => set({ action: e.target.value })} placeholder="Choose an action…">
              {[...new Set(ACTIONS.map((a) => a.group))].map((g) => (
                <optgroup key={g} label={g}>{ACTIONS.filter((a) => a.group === g).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>
              ))}
            </Select>
          </Field>
          {actionById(b.action)?.arg === "program" && (
            <Field label="Motion program">
              <Select value={b.arg || ""} onChange={(e) => set({ arg: e.target.value })} placeholder={programs.isLoading ? "Loading…" : "Choose…"} options={programNames} />
            </Field>
          )}
        </>
      )}

      {b.kind === "plc" && (
        <>
          <Field label="Address or name" hint={isPlcRegister(b.name) ? "Register: a number" : /^m\d+$/i.test(b.name || "") ? "M bit: can be set from here" : b.name ? "Inputs, outputs and system bits are shown; M bits and registers can be set" : "M10, R3, joint1.di2, S.AUTO or a name from the program"}>
            <Combobox value={b.name || ""} onChange={(name) => set({ name: name.trim() })} options={plcOptions} placeholder="Type to search: M10, R3, a name…" ariaLabel="PLC address or name" />
          </Field>
        </>
      )}

      {b.kind === "io" && (
        <>
          <Field label="Device"><Select value={b.device || ""} onChange={(e) => set({ device: e.target.value, pin: ioPins(e.target.value, b.dir || "di")[0] })} placeholder="Choose…" options={IO_DEVICES} /></Field>
          <Field label="Signal">
            <Segmented value={b.dir || "di"} onChange={(dir) => set({ dir, pin: ioPins(b.device || "joint1", dir)[0] })} options={[{ value: "di", label: "Input" }, { value: "do", label: "Output" }]} />
          </Field>
          <Field label="Pin"><Select value={b.pin || ""} onChange={(e) => set({ pin: e.target.value })} options={ioPins(b.device || "joint1", b.dir || "di")} /></Field>
        </>
      )}

      {b.kind === "iolist" && (
        <>
          <Field label="List"><Segmented value={b.dir || "di"} onChange={(dir) => set({ dir, name: "" })} options={[{ value: "di", label: "Inputs" }, { value: "do", label: "Outputs" }]} /></Field>
          <Field label="Signal">
            <Select value={b.name || ""} onChange={(e) => set({ name: e.target.value })} placeholder="Choose…" options={((b.dir === "do" ? dout.data : di.data) || []).map((x) => ({ value: x.name, label: ioLabel(x.name) }))} />
          </Field>
        </>
      )}

      {b.kind === "topic" && (
        <>
          <Field label="Topic" hint={topics.data?.simulated ? "Simulator: demo topics" : topics.data?.message || ""}>
            <Combobox
              value={b.name || ""}
              onChange={(v) => { const name = v.trim(); const t = (topics.data?.topics || []).find((x) => x.name === name); set(t ? { name, type: t.type } : { name }); }}
              options={(topics.data?.topics || []).map((t) => ({ value: t.name, hint: t.type }))}
              placeholder="/cell/lamp"
              ariaLabel="Topic"
            />
          </Field>
          <Field label="Type"><Select value={b.type || "bool"} onChange={(e) => set({ type: e.target.value })} options={TOPIC_TYPES} /></Field>
        </>
      )}

      {b.kind === "bb" && (
        <Field label="Blackboard entry" hint="Shown only: the program runner has no service to change its blackboard. To give the program a value, use a PLC bit or a topic it reads.">
          <Combobox value={b.key || ""} onChange={(key) => set({ key: key.trim() })} options={bbKeys} placeholder="part_count" ariaLabel="Blackboard entry" />
        </Field>
      )}

      {b.kind === "robot" && (
        <Field label="State"><Select value={b.key || ""} onChange={(e) => set({ key: e.target.value })} placeholder="Choose…" options={robotKeysFor(type).map((k) => ({ value: k.id, label: k.label }))} /></Field>
      )}

      {b.kind === "setting" && (
        <Field label="Setting"><Select value={b.key || ""} onChange={(e) => set({ key: e.target.value })} placeholder="Choose…" options={Object.entries(SETTING_KEYS).map(([value, s]) => ({ value, label: s.label }))} /></Field>
      )}
    </div>
  );
}

function ButtonFields({ w, set }) {
  const b = w.binding || {};
  if (!b.kind || b.kind === "action") return null;
  const register = b.kind === "plc" && isPlcRegister(b.name);
  const modes = b.kind === "topic" || register
    ? [{ value: "send", label: "Send value" }]
    : [{ value: "pulse", label: "Pulse" }, { value: "momentary", label: "Hold" }, { value: "toggle", label: "Toggle" }, { value: "set", label: "Set" }, { value: "reset", label: "Reset" }];
  const mode = b.mode || modes[0].value;
  const setB = (patch) => set({ binding: { ...b, ...patch } });
  return (
    <div className="op-form-row">
      <Field label="When pressed"><Segmented value={mode} onChange={(m) => setB({ mode: m })} options={modes} /></Field>
      {mode === "pulse" && <Field label="Pulse length (ms)"><Input type="number" min={20} step={10} value={b.pulse_ms ?? 300} onChange={(e) => setB({ pulse_ms: Number(e.target.value) })} /></Field>}
      {mode === "send" && <Field label="Value to send"><Input value={b.value ?? ""} onChange={(e) => setB({ value: e.target.value })} placeholder={b.type === "bool" ? "true" : "1"} /></Field>}
    </div>
  );
}

function OptionsFields({ w, set }) {
  const b = w.binding || {};
  if (b.kind === "setting" || b.kind === "robot" || !b.kind) return null;
  const opts = w.options || [];
  const setOpt = (i, patch) => set({ options: opts.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  return (
    <Field label="Choices (label → value written)">
      <div className="op-opts">
        {opts.map((o, i) => (
          <div key={i} className="op-opt">
            <Input size="sm" value={o.label} placeholder="Label" onChange={(e) => setOpt(i, { label: e.target.value })} />
            <Input size="sm" value={o.value} placeholder="Value" onChange={(e) => setOpt(i, { value: e.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => set({ options: opts.filter((_, k) => k !== i) })} title="Remove"><Trash2 size={14} /></Button>
          </div>
        ))}
        <Button size="sm" onClick={() => set({ options: [...opts, { label: `Option ${opts.length + 1}`, value: String(opts.length + 1) }] })}><Plus size={14} /> Choice</Button>
      </div>
    </Field>
  );
}

function GroupFields({ w, set }) {
  const b = w.binding || { kind: "group", source: "iolist", dir: "di" };
  const setB = (patch) => set({ binding: { ...b, kind: "group", ...patch } });
  const items = b.items || [];
  const setItem = (i, patch) => setB({ items: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  return (
    <>
      <div className="op-form-row">
        <Field label="Signals"><Segmented value={b.dir || "di"} onChange={(dir) => setB({ dir })} options={[{ value: "di", label: "Inputs (lamps)" }, { value: "do", label: "Outputs (switches)" }]} /></Field>
        <Field label="Taken from"><Segmented value={b.source || "iolist"} onChange={(source) => setB({ source })} options={[{ value: "iolist", label: "The whole IO list" }, { value: "custom", label: "Chosen signals" }]} /></Field>
      </div>
      {b.source === "custom" && (
        <div className="op-gitems">
          {items.map((it, i) => (
            <div key={i} className="op-gitem-edit">
              <Field label={`Signal ${i + 1}`}><Input size="sm" value={it.label || ""} placeholder="Label" onChange={(e) => setItem(i, { label: e.target.value })} /></Field>
              <BindingFields compact type={b.dir === "do" ? "toggle" : "indicator"} b={it.binding || {}} onChange={(binding) => setItem(i, { binding })} />
              <Button size="sm" variant="ghost" onClick={() => setB({ items: items.filter((_, k) => k !== i) })} title="Remove"><Trash2 size={14} /></Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setB({ items: [...items, { label: `Signal ${items.length + 1}`, binding: { kind: "plc", name: "" } }] })}><Plus size={14} /> Signal</Button>
        </div>
      )}
    </>
  );
}

export default function WidgetEditor({ widget, onSave, onClose, onDelete }) {
  const [w, setW] = useState(widget);
  const set = (patch) => setW((cur) => ({ ...cur, ...patch }));
  const def = WIDGETS[w.type] || {};
  const b = w.binding || {};
  const action = b.kind === "action" ? actionById(b.action) : null;
  const acts = w.type !== "indicator" && w.type !== "display" && w.type !== "label" && !(w.type === "group" && b.dir !== "do");

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`${def.label || "Widget"} settings`}
      description={def.hint}
      footer={
        <>
          {onDelete && <Button variant="ghost-danger" onClick={onDelete} style={{ marginRight: "auto" }}><Trash2 size={14} /> Remove</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(w)}>Apply</Button>
        </>
      }
    >
      <div className="op-form">
        <div className="op-form-row">
          <Field label={w.type === "label" ? "Heading" : "Label"}>
            <Input value={w.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder={action?.label || def.label} autoFocus />
          </Field>
          <Field label="Kind">
            <Select value={w.type} onChange={(e) => set({ type: e.target.value, binding: WIDGETS[e.target.value].kinds.includes(b.kind) ? b : e.target.value === "group" ? { kind: "group", source: "iolist", dir: "di" } : {} })} options={Object.entries(WIDGETS).map(([value, x]) => ({ value, label: x.label }))} />
          </Field>
        </div>
        {w.type === "label" && (
          <>
            <Field label="Note (optional)"><Input value={w.note || ""} onChange={(e) => set({ note: e.target.value })} /></Field>
            <div className="op-form-row">
              <Field label="Text size">
                <Segmented value={w.textSize || "sm"} onChange={(textSize) => set({ textSize })} options={HEADING_SIZES} />
              </Field>
              <Field label="Letters">
                <Segmented value={w.caps === false ? "normal" : "caps"} onChange={(v) => set({ caps: v === "caps" })} options={[{ value: "caps", label: "CAPITALS" }, { value: "normal", label: "Normal" }]} />
              </Field>
            </div>
          </>
        )}

        {w.type === "group" ? <GroupFields w={w} set={set} /> : def.kinds?.length ? <BindingFields type={w.type} b={b} onChange={(binding) => set({ binding })} /> : null}
        {w.type === "button" && <ButtonFields w={w} set={set} />}
        {CHOICE_TYPES.has(w.type) && <OptionsFields w={w} set={set} />}

        {(NUM_TYPES.has(w.type) || w.type === "display") && (
          <div className="op-form-row">
            {NUM_TYPES.has(w.type) && <>
              <Field label="Minimum"><Input type="number" value={w.min ?? ""} onChange={(e) => set({ min: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
              <Field label="Maximum"><Input type="number" value={w.max ?? ""} onChange={(e) => set({ max: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
              <Field label="Step"><Input type="number" value={w.step ?? ""} onChange={(e) => set({ step: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
            </>}
            <Field label="Unit"><Input value={w.unit || ""} onChange={(e) => set({ unit: e.target.value })} placeholder="mm, s, %" /></Field>
            <Field label="Decimals"><Input type="number" min={0} max={6} value={w.decimals ?? ""} onChange={(e) => set({ decimals: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
          </div>
        )}

        {(BOOL_TYPES.has(w.type) || w.type === "display") && (
          <div className="op-form-row">
            <Field label="Text when on"><Input value={w.onText || ""} placeholder="ON" onChange={(e) => set({ onText: e.target.value })} /></Field>
            <Field label="Text when off"><Input value={w.offText || ""} placeholder="OFF" onChange={(e) => set({ offText: e.target.value })} /></Field>
            {w.type === "indicator" && <div className="op-checks"><Checkbox label="Light when the signal is off" checked={w.invert} onChange={(v) => set({ invert: v })} /><Checkbox label="Blink while lit" checked={w.blink} onChange={(v) => set({ blink: v })} /></div>}
          </div>
        )}

        <div className="op-form-row">
          <Field label="Colour">
            <div className="op-swatches">
              {COLORS.map((c) => (
                <button key={c.id} type="button" className={cx("op-swatch", `op-c-${c.id}`, (w.color || "auto") === c.id && "is-active")} onClick={() => set({ color: c.id })} title={c.label}><span /></button>
              ))}
            </div>
          </Field>
          <Field label="Width (of 12)"><Input type="number" min={1} max={12} value={w.w} onChange={(e) => set({ w: Number(e.target.value) || 1 })} /></Field>
          <Field label="Height (rows)"><Input type="number" min={1} max={8} value={w.h} onChange={(e) => set({ h: Number(e.target.value) || 1 })} /></Field>
        </div>

        {acts && (
          <div className="op-checks op-safety">
            <Checkbox
              label={action?.safe ? "Allowed while the robot works (a stop / reset action)" : "Only when the robot is stopped (program not running, robot still)"}
              checked={action?.safe ? true : w.guard !== false}
              disabled={Boolean(action?.safe)}
              onChange={(v) => set({ guard: v })}
            />
            <Checkbox label="Ask before it acts" checked={w.confirm ?? Boolean(action?.confirm)} onChange={(v) => set({ confirm: v })} />
            <Checkbox label="Show a message after it acts" checked={w.feedback !== false} onChange={(v) => set({ feedback: v })} />
          </div>
        )}
      </div>
    </Modal>
  );
}
