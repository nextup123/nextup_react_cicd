// Tool centre point offset of the Cartesian broadcaster (set_tcp_offset),
// edited in Settings › Point teach.
import { useState } from "react";
import { Alert, Button, Field, Input } from "../ui";
import { robotApi, robotCall } from "../../lib/robotApi";

const KEY = "nextup.tcpOffset";
const FIELDS = [
  ["x", "X (mm)"], ["y", "Y (mm)"], ["z", "Z (mm)"],
  ["roll", "Roll (°)"], ["pitch", "Pitch (°)"], ["yaw", "Yaw (°)"],
];

function readLast() {
  try {
    return { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 };
  }
}

export function TcpOffsetEditor() {
  const [v, setV] = useState(readLast);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, Number(v[k]) || 0]));
    const r = await robotCall(() => robotApi.setTcpOffset(body));
    setBusy(false);
    if (r?.ok) {
      try {
        localStorage.setItem(KEY, JSON.stringify(body));
      } catch {
        /* ignore */
      }
    }
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="limits-grid">
        {FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input type="number" step="0.1" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Alert tone="info">The offset is applied until the controller restarts. Put permanent tool data in the robot description.</Alert>
      <div className="st-actions">
        <span className="grow" />
        <Button variant="primary" loading={busy} onClick={apply}>Apply offset</Button>
      </div>
    </div>
  );
}
