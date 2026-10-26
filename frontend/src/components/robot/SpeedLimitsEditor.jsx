// Overspeed thresholds per mode (supervisor get/set_mode_speed_limits),
// edited in Settings › Robot.
import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Loading, Segmented, Alert } from "../ui";
import { robotApi } from "../../lib/robotApi";
import { toast } from "../../store/toast";
import { PROFILE_LABEL } from "../../lib/robotText";
import { useRobot } from "../../store/robot";

export function SpeedLimitsEditor() {
  const profile = useRobot((s) => s.supervisor?.profile);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("jog");
  const [values, setValues] = useState([]);
  const [persist, setPersist] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLimits(null);
    setError(null);
    robotApi.speedLimits().then((r) => (r.ok ? setLimits(r.limits) : setError(r.message))).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  // start on the active mode once it is known
  useEffect(() => {
    if (profile) setMode(profile);
  }, [profile]);

  useEffect(() => {
    if (limits?.[mode]) setValues(limits[mode].thresholds.map(String));
  }, [limits, mode]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await robotApi.setSpeedLimits(mode, values.map(Number), persist);
      if (r.ok) {
        toast.success(r.message || "Limits saved");
        setLimits({ ...limits, [mode]: { ...limits[mode], thresholds: values.map(Number) } });
      } else toast.error(r.message || "Refused");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cur = limits?.[mode];
  if (error)
    return (
      <Alert tone="warning" action={<Button size="sm" onClick={load}>Retry</Button>}>
        {error}
      </Alert>
    );
  if (!limits) return <Loading />;
  return (
    <div className="col" style={{ gap: 12 }}>
      <Segmented block value={mode} onChange={setMode} options={Object.keys(limits).map((m) => ({ value: m, label: `${PROFILE_LABEL[m]}${m === profile ? " (active)" : ""}` }))} />
      <div className="limits-grid">
        {(cur?.joints || []).map((j, i) => (
          <label key={j} className="col" style={{ gap: 4 }}>
            <span className="xs muted">{j}</span>
            <Input size="sm" type="number" min={0} max={32767} value={values[i] ?? ""} onChange={(e) => setValues(values.map((v, k) => (k === i ? e.target.value : v)))} />
          </label>
        ))}
      </div>
      <span className="xs muted">Speed scale cap in {PROFILE_LABEL[mode]}: {cur?.maxSpeedScale ?? "–"} %. Values are drive units (int16). The supervisor writes the active mode's values to the drives on every mode change.</span>
      <div className="st-actions">
        <Checkbox label="Keep after a restart (save to the robot's configuration)" checked={persist} onChange={setPersist} />
        <span className="grow" />
        <Button variant="primary" onClick={save} loading={saving} disabled={!cur}>Apply {PROFILE_LABEL[mode]}</Button>
      </div>
    </div>
  );
}
