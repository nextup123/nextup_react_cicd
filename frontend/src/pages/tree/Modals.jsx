// Dialogs of the tree editor: insert a subtree, preview a subtree, XML view
// and the keyboard shortcut list.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, Link2, Maximize2, Minus, Plus, RefreshCw, Files } from "lucide-react";
import { Alert, Button, Field, Input, Kbd, Loading, Modal, Segmented, Select, cx } from "../../components/ui";
import { toast } from "../../store/toast";
import TreeCanvas from "./TreeCanvas";
import { usePreviewSubtree, useTreeXml } from "./treeApi";
import { RUN_PROGRAM_ATTRS, autoName, capabilities, doDiFlavour } from "./treeModel";
import { NAV_SHORTCUTS, useQuickAdd } from "./shortcuts";

const KIND_LABEL = { template: "subtree", doDi: "DO/DI subtree" };

/* ───────────── Insert subtree (template / DO-DI) ───────────── */
export function InsertSubtreeModal({ request, parent, onClose, onConfirm }) {
  const [mode, setMode] = useState("full");
  const [flag, setFlag] = useState("true");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setMode("full");
    setFlag("true");
  }, [request]);
  if (!request) return null;
  const { kind, id } = request;
  const flavour = kind === "doDi" ? doDiFlavour(id) : null;
  const flagAttr = flavour === "DO" ? "expected_action" : "expected_status";

  const submit = async () => {
    let attributes = {};
    if (mode === "reference" && kind === "doDi") attributes = { [flagAttr]: flag };
    setSaving(true);
    const ok = await onConfirm(kind, id, mode, attributes);
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Modal
      open
      tut="bt-insert-subtree"
      onClose={onClose}
      title={`Insert ${KIND_LABEL[kind]}`}
      description={`"${id}" goes inside "${parent?.name ?? "?"}", wrapped in its own Sequence.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Insert
          </Button>
        </>
      }
    >
      <div className="bt-form">
        <Segmented
          block
          value={mode}
          onChange={setMode}
          options={[
            { value: "full", label: "Full copy", icon: Files },
            { value: "reference", label: "Link (<SubTreePlus>)", icon: Link2 },
          ]}
        />
        <div className="small muted">
          {mode === "full"
            ? "Copies all nodes of the subtree. Later changes to the original are not picked up."
            : "Adds a link to the subtree. Changes to the original apply everywhere it is linked."}
        </div>
        {mode === "reference" && kind === "doDi" && (
          <Field label={flavour === "DO" ? "Output action (expected_action)" : "Expected input state (expected_status)"}>
            <Segmented
              value={flag}
              onChange={setFlag}
              options={[
                { value: "true", label: "true" },
                { value: "false", label: "false" },
              ]}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ───────────── Add a motion program (<RunProgram program="…"/>) ───────────── */
const OFFSETS = ["offset_x", "offset_y", "offset_z", "offset_rx", "offset_ry", "offset_rz"];
const numOrBlank = (v) => v.trim() === "" || Number.isFinite(Number(v));

export function RunProgramModal({ request, node, lib, tree, programs, onClose, onConfirm }) {
  const [program, setProgram] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [repeat, setRepeat] = useState("1");
  const [speed, setSpeed] = useState("");
  const [acc, setAcc] = useState("");
  const [offsets, setOffsets] = useState({});
  const [shiftOpen, setShiftOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setProgram(request?.name || "");
    setNameEdited(false);
    setRepeat("1");
    setSpeed("");
    setAcc("");
    setOffsets({});
    setShiftOpen(false);
  }, [request]);
  // Default node name: the program's name, made unique in this subtree.
  useEffect(() => {
    if (nameEdited || !request) return;
    if (!program) return setName("");
    const taken = new Set();
    tree?.byKey?.forEach((n) => taken.add(n.name));
    setName(taken.has(program) ? autoName(program, tree) : program);
  }, [program, nameEdited, request, tree]);
  if (!request) return null;

  const target = request.node || node;
  const names = (programs || []).map((p) => p.name);
  const caps = capabilities(tree, target, lib);
  const where = request.mode || (caps.addChild.ok ? "child" : "after");
  const rep = Number(repeat);
  const errors = {
    program: !program ? "Choose a program" : "",
    name: !name.trim() ? "Give the node a name" : "",
    repeat: repeat.trim() === "" || !Number.isInteger(rep) || rep < -1 || rep === 0 ? "Whole number: 1 or more, or -1 for the program's own setting (0 is not allowed in a tree)" : "",
    speed: !numOrBlank(speed) || Number(speed) < 0 ? "A number of 0 or more, or empty" : "",
    acc: !numOrBlank(acc) || Number(acc) < 0 ? "A number of 0 or more, or empty" : "",
    offsets: OFFSETS.some((k) => !numOrBlank(offsets[k] || "")) ? "Offsets must be numbers" : "",
  };
  const bad = Object.values(errors).some(Boolean);

  const attrs = () => {
    const a = { program, repeat: String(rep) };
    if (speed.trim() !== "" && Number(speed) !== 0) a.speed = speed.trim();
    if (acc.trim() !== "" && Number(acc) !== 0) a.acceleration = acc.trim();
    OFFSETS.forEach((k) => {
      const v = (offsets[k] || "").trim();
      if (v !== "" && Number(v) !== 0) a[k] = v;
    });
    return a;
  };
  const preview = `<RunProgram name="${name.trim()}" ${Object.entries(attrs()).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`;

  const submit = async (e) => {
    e?.preventDefault();
    if (bad) return;
    setSaving(true);
    const ok = await onConfirm(attrs(), name.trim(), where);
    setSaving(false);
    if (ok !== false) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a motion program"
      description={target ? `A RunProgram node goes ${where === "child" ? "inside" : "right after"} "${target.name}". Change its settings later in the node editor.` : "Select a node in the tree first."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Plus} onClick={submit} loading={saving} disabled={bad || !target} title={bad ? Object.values(errors).find(Boolean) : undefined}>
            Add
          </Button>
        </>
      }
    >
      <form className="bt-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Program" error={program && errors.program} hint={programs?.find((p) => p.name === program)?.description || undefined}>
            <Select value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Choose a program…">
              {program && !names.includes(program) && <option value={program}>{program}</option>}
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Node name" error={errors.name} hint="Shown in the tree and in the runner">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              invalid={!!errors.name}
            />
          </Field>
          <Field label="Repeat" error={errors.repeat} hint={RUN_PROGRAM_ATTRS.repeat.hint}>
            <Input type="number" step="1" min="-1" value={repeat} onChange={(e) => setRepeat(e.target.value)} invalid={!!errors.repeat} />
          </Field>
          <Field label="Speed (m/s)" error={errors.speed} hint="Empty = the program's own speed">
            <Input type="number" step="0.01" min="0" value={speed} placeholder="as programmed" onChange={(e) => setSpeed(e.target.value)} invalid={!!errors.speed} />
          </Field>
          <Field label="Acceleration (m/s²)" error={errors.acc} hint="Empty = the program's own">
            <Input type="number" step="0.1" min="0" value={acc} placeholder="as programmed" onChange={(e) => setAcc(e.target.value)} invalid={!!errors.acc} />
          </Field>
        </div>
        <button type="button" className="bt-rp-fold" onClick={() => setShiftOpen((o) => !o)} aria-expanded={shiftOpen}>
          {shiftOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Shift the whole program (palletizing offset)
        </button>
        {shiftOpen && (
          <>
            <div className="bt-rp-offsets">
              {OFFSETS.map((k) => (
                <Field key={k} label={`${k.replace("offset_", "").toUpperCase()} (${RUN_PROGRAM_ATTRS[k].unit})`}>
                  <Input
                    size="sm"
                    type="number"
                    value={offsets[k] || ""}
                    placeholder="0"
                    onChange={(e) => setOffsets((o) => ({ ...o, [k]: e.target.value }))}
                    title={RUN_PROGRAM_ATTRS[k].hint}
                  />
                </Field>
              ))}
            </div>
            {errors.offsets && <span className="field-error">{errors.offsets}</span>}
          </>
        )}
        {!names.length && <Alert tone="warning">There are no motion programs yet. Create one on the Motion Programs page first.</Alert>}
        <code className="bt-rp-preview" title="What is added to the tree">{preview}</code>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ───────────── Preview ───────────── */
export function PreviewModal({ request, lib, labelTypes, onClose, onOpen }) {
  const q = usePreviewSubtree(request?.kind, request?.id);
  const canvas = useRef(null);
  if (!request) return null;
  const suffix = request.kind === "doDi" ? " (DO/DI)" : "";
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={`Preview: ${request.id}${suffix}`}
      description={q.data ? `${q.data.count} nodes. Read only; scroll to zoom, drag to pan.` : undefined}
      bodyClassName="bt-preview-body"
      footer={
        <>
          <Button icon={RefreshCw} onClick={() => q.refetch()} loading={q.isFetching}>
            Reload
          </Button>
          <Button icon={Maximize2} onClick={() => canvas.current?.fit()} disabled={!q.data}>
            Fit
          </Button>
          <span className="grow" />
          {request.kind === "template" && (
            <Button
              variant="primary"
              icon={ExternalLink}
              onClick={() => {
                onOpen(request.id);
                onClose();
              }}
            >
              Open in editor
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="bt-preview">
        {q.isLoading && <Loading label="Loading subtree…" />}
        {q.isError && <Alert tone="danger">{q.error?.message || "Could not load the subtree"}</Alert>}
        {q.data && <TreeCanvas ref={canvas} tree={q.data} viewId={`${request.kind}:${request.id}`} lib={lib} readOnly labelTypes={labelTypes} />}
      </div>
    </Modal>
  );
}

/* ───────────── XML view ───────────── */
const XML_TITLES = { mainTree: "Subtrees source", doDiTree: "DO/DI source" };
const FONT_KEY = "nextup.tree.xmlFont";

export function XmlModal({ type, onClose }) {
  const q = useTreeXml(type, !!type);
  const [font, setFont] = useState(() => {
    try {
      return Number(localStorage.getItem(FONT_KEY)) || 12;
    } catch {
      return 12;
    }
  });
  const changeFont = (d) =>
    setFont((f) => {
      const v = Math.min(24, Math.max(8, f + d));
      try {
        localStorage.setItem(FONT_KEY, String(v));
      } catch {
        /* ignore */
      }
      return v;
    });
  if (!type) return null;

  const copy = async () => {
    const text = q.data || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast.success("Source copied to the clipboard");
  };

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={XML_TITLES[type]}
      description="Generated from the saved file, internal ids removed."
      footer={
        <>
          <Button icon={Minus} onClick={() => changeFont(-1)} title="Smaller text" />
          <Button icon={Plus} onClick={() => changeFont(1)} title="Larger text" />
          <span className="grow" />
          <Button icon={RefreshCw} onClick={() => q.refetch()} loading={q.isFetching}>
            Reload
          </Button>
          <Button icon={Copy} onClick={copy} disabled={!q.data}>
            Copy
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {q.isLoading && <Loading label="Loading source…" />}
      {q.isError && <Alert tone="danger">{q.error?.message || "Could not load the source"}</Alert>}
      {q.data !== undefined && !q.isError && (
        <pre className={cx("code-block", "bt-xml")} style={{ fontSize: font }}>
          {q.data || "(empty)"}
        </pre>
      )}
    </Modal>
  );
}

/* ───────────── Shortcut list ───────────── */
export function ShortcutsModal({ open, onClose }) {
  const items = useQuickAdd((s) => s.items).filter((s) => s.key);
  if (!open) return null;
  return (
    <Modal open tut="bt-shortcuts" size="lg" onClose={onClose} title="Keyboard shortcuts" description="Work when the focus is not in a text field.">
      <div className="bt-keys-grid">
        <div>
          <div className="section-label">Add inside selected</div>
          {items.map((s) => (
            <KeyRow key={s.key} keys={["Shift", s.key.toUpperCase()]} label={s.label} />
          ))}
          {items.length === 0 && <div className="small muted">No keys set. Edit the Quick add list in the library.</div>}
        </div>
        <div>
          <div className="section-label">Add after selected</div>
          {items.map((s) => (
            <KeyRow key={s.key} keys={["Alt", s.key.toUpperCase()]} label={s.label} />
          ))}
        </div>
        <div>
          <div className="section-label">Navigate and edit</div>
          {NAV_SHORTCUTS.map((s) => (
            <KeyRow key={s.label} keys={s.keys} label={s.label} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function KeyRow({ keys, label }) {
  return (
    <div className="bt-key-row">
      <span className="bt-key-combo">
        {keys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="muted"> + </span>}
            <Kbd>{k}</Kbd>
          </span>
        ))}
      </span>
      <span className="small">{label}</span>
    </div>
  );
}
