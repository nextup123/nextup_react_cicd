import { useEffect, useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Switch, Textarea } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { useRobot } from "../../store/robot";
import { NAME_RE, capturePose, fmt, pointDateTime, pointsApi, rad2deg, refreshPoints } from "./pointsApi";

const SEQUENCES = Array.from({ length: 10 }, (_, i) => String(i + 1));
const SEQ_KEY = "nextup.pp.lastSequence";

function readLastSequence() {
  try {
    return localStorage.getItem(SEQ_KEY) || "1";
  } catch {
    return "1";
  }
}

/** Final point name, applying the old "-tf" suffix rules. */
function resolveName(rawName, isTf, editingName) {
  let name = rawName.trim();
  if (editingName) {
    if (isTf && editingName.endsWith("-tf")) return editingName;
    if (isTf && !editingName.endsWith("-tf")) return `${name}-tf`;
    if (!isTf && editingName.endsWith("-tf")) return editingName.slice(0, -3);
    return name;
  }
  return isTf ? `${name}-tf` : name;
}

function PoseTable({ saved }) {
  const positions = useRobot((s) => s.positions);
  const cartesian = useRobot((s) => s.cartesian);
  const liveJ = (positions || []).map(rad2deg);
  const liveC = cartesian || [];
  const savedJ = saved ? [1, 2, 3, 4, 5, 6].map((i) => rad2deg(saved.joints_values?.[`joint${i}`])) : null;
  const savedC = saved ? ["x", "y", "z", "r", "p", "w"].map((k) => saved.coordinate?.[k]) : null;
  const jl = ["J1", "J2", "J3", "J4", "J5", "J6"];
  const cl = ["X cm", "Y cm", "Z cm", "R °", "P °", "W °"];
  return (
    <div className="table-wrap">
      <table className="table compact pp-pose-table tabular">
        <thead>
          <tr>
            <th />
            {jl.map((l) => (
              <th key={l}>{l} °</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="strong">Robot now</td>
            {liveJ.map((v, i) => (
              <td key={i}>{fmt(v)}</td>
            ))}
          </tr>
          {savedJ && (
            <tr className="muted">
              <td>Saved</td>
              {savedJ.map((v, i) => (
                <td key={i}>{fmt(v)}</td>
              ))}
            </tr>
          )}
        </tbody>
        <thead>
          <tr>
            <th />
            {cl.map((l) => (
              <th key={l}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="strong">Robot now</td>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <td key={i}>{fmt(liveC[i])}</td>
            ))}
          </tr>
          {savedC && (
            <tr className="muted">
              <td>Saved</td>
              {savedC.map((v, i) => (
                <td key={i}>{fmt(v)}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Add a new point (captures the current robot pose) or edit an existing one.
 * `point` null = add mode.
 */
export function PointEditorModal({ open, point, onClose, publishEdits }) {
  const editing = Boolean(point);
  const [name, setName] = useState("");
  const [sequence, setSequence] = useState("1");
  const [nature, setNature] = useState("");
  const [natureTouched, setNatureTouched] = useState(false);
  const [isTf, setIsTf] = useState(false);
  const [editable, setEditable] = useState(true);
  const [recapture, setRecapture] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setRecapture(true);
    if (point) {
      setName(point.name);
      setSequence(String(point.sequence ?? "1"));
      setNature(point.nature || "");
      setNatureTouched(true);
      setIsTf(Boolean(point.is_tf));
      setEditable(point.is_editable ?? true);
    } else {
      setName("");
      setSequence(readLastSequence());
      setNature("");
      setNatureTouched(false);
      setIsTf(false);
      setEditable(true);
    }
  }, [open, point]);

  const finalName = useMemo(() => resolveName(name, isTf, point?.name), [name, isTf, point]);

  const build = () => {
    const pose = editing && !recapture ? { joints_values: point.joints_values, coordinate: point.coordinate } : capturePose();
    return {
      name: finalName,
      date_time: pointDateTime(),
      sequence: Number(sequence),
      nature: (nature.trim() || name.trim()).slice(0, 30),
      is_tf: isTf,
      is_calibrated: editing ? Boolean(point.is_calibrated) : false,
      is_editable: editable,
      ...pose,
    };
  };

  const validate = (p) => {
    if (!p.name || !NAME_RE.test(p.name)) return "Point name may only contain letters, numbers, dashes and underscores.";
    if (!p.nature || p.nature.length > 30) return "Description is required and must be 30 characters or less.";
    if (isNaN(p.sequence) || p.sequence < 1 || p.sequence > 10) return "Sequence must be between 1 and 10.";
    const nums = [...Object.values(p.joints_values || {}), ...Object.values(p.coordinate || {})];
    if (nums.length !== 12 || nums.some((v) => typeof v !== "number" || isNaN(v))) return "No valid robot position received yet.";
    return null;
  };

  const add = async (p) => {
    const res = await pointsApi.add(p);
    toast.success(res?.message || `Added point ${p.name}`);
    try {
      localStorage.setItem(SEQ_KEY, String(p.sequence));
    } catch {
      /* ignore */
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    const p = build();
    const v = validate(p);
    if (v) return setError(v);
    setError(null);
    setSaving(true);
    try {
      if (!editing) {
        await add(p);
        onClose();
        return;
      }
      if (p.name !== point.name) {
        // Names cannot change (old "name cannot be changed" dialog).
        const ok = await confirm({
          title: "Point name cannot be changed",
          message: `Changing the TF setting would rename "${point.name}" to "${p.name}". Add a new point named "${p.name}" instead?`,
          confirmLabel: "Add as new point",
        });
        if (ok) {
          await add(p);
          onClose();
        }
        return;
      }
      const res = await pointsApi.update(point.name, p);
      toast.success(res?.message || `Updated ${p.name}`);
      if (publishEdits) {
        try {
          await pointsApi.editedPoint(p.name);
          toast.info(`${p.name} published to the robot`);
        } catch (err) {
          toast.warning(`Saved, but could not notify the robot: ${errorMessage(err)}`);
        }
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
      refreshPoints();
    }
  };

  return (
    <Modal
      open={open}
      tut="point-editor"
      onClose={onClose}
      size="lg"
      title={editing ? `Edit point "${point?.name}"` : "Teach a new point"}
      description={editing ? `Last saved ${point?.date_time || "—"}` : "The robot's current position is saved with the point."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={editing ? Save : Plus} loading={saving} onClick={submit}>
            {editing ? "Update point" : "Add point"}
          </Button>
        </>
      }
    >
      <form className="col" style={{ gap: 16 }} onSubmit={submit}>
        <div className="form-grid">
          <Field
            label="Point name"
            hint={finalName && finalName !== name.trim() ? `Will be saved as "${finalName}"` : "Letters, numbers, - and _"}
          >
            <Input
              autoFocus={!editing}
              value={name}
              readOnly={editing}
              title={editing ? "Point names cannot be changed" : undefined}
              placeholder="e.g. pick_1"
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!natureTouched) setNature(v.slice(0, 30));
              }}
            />
          </Field>
          <Field label="Sequence" hint="Group number used by programs">
            <Select value={sequence} onChange={(e) => setSequence(e.target.value)} options={SEQUENCES} />
          </Field>
          <Field label="Description" hint={`${nature.length}/30 characters (stored as "nature")`} span2>
            <Textarea
              rows={2}
              maxLength={30}
              value={nature}
              placeholder="e.g. above the conveyor"
              onChange={(e) => {
                setNature(e.target.value);
                setNatureTouched(true);
              }}
              style={{ minHeight: 52 }}
            />
          </Field>
          <Field label="Reference frame (TF)" hint='Usable as a jog frame; name gets a "-tf" suffix'>
            <Switch checked={isTf} onChange={setIsTf} label={isTf ? "TF point" : "Normal point"} />
          </Field>
          <Field label="Editing" hint="Locked points cannot be edited or deleted">
            <Switch checked={editable} onChange={setEditable} label={editable ? "Editable" : "Locked"} />
          </Field>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <div className="row">
            <span className="section-label grow">Position</span>
            {editing && (
              <Checkbox checked={recapture} onChange={setRecapture} label="Replace saved position with the robot's current position" />
            )}
          </div>
          <PoseTable saved={editing ? point : null} />
          {editing && recapture && (
            <span className="xs muted">Updating saves the robot's current position into this point (as before). Untick to change only the details.</span>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
