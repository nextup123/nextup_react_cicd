// Signal watch (drive state broadcaster io_watch): named inputs whose edges are
// logged with time, duration and the robot pose at that moment. Live edges
// arrive as IO_EVENT; the list and the log come from the services.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Plus, Radio, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, IconButton, Input, Modal, Select, StatusDot, Field } from "../../components/ui";
import { robotApi, robotCall } from "../../lib/robotApi";
import { useRobot } from "../../store/robot";

const DEVICES = ["gpio1", "joint1", "joint2", "joint3", "joint4", "joint5", "joint6"];
const INPUTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `di${n}`);
const timeOf = (e) => (e.time ? e.time.slice(-8) : e.stamp ? new Date(e.stamp).toLocaleTimeString() : "");

function AddWatchModal({ open, onClose, onAdded }) {
  const [f, setF] = useState({ name: "", device: "gpio1", input: "di1", logRising: true, logFalling: true, debounceMs: 10 });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const add = async () => {
    setBusy(true);
    const r = await robotCall(() => robotApi.addIoWatch(f));
    setBusy(false);
    if (r?.ok) {
      onAdded();
      onClose();
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Watch a signal"
      description="Every change of this input is logged with its time, how long it held, and the robot position."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={add}>Watch</Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name" hint="e.g. part_present, door_closed">
          <Input value={f.name} onChange={(e) => set("name", e.target.value.replace(/[^A-Za-z0-9_.-]/g, "_"))} />
        </Field>
        <div className="form-grid">
          <Field label="Device">
            <Select value={f.device} onChange={(e) => set("device", e.target.value)}>
              {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Input">
            <Select value={f.input} onChange={(e) => set("input", e.target.value)}>
              {INPUTS.map((d) => <option key={d} value={d}>{d.toUpperCase()}</option>)}
            </Select>
          </Field>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Checkbox label="Log rising edges" checked={f.logRising} onChange={(v) => set("logRising", v)} />
          <Checkbox label="Log falling edges" checked={f.logFalling} onChange={(v) => set("logFalling", v)} />
        </div>
        <Field label="Debounce (ms)">
          <Input type="number" min={0} value={f.debounceMs} onChange={(e) => set("debounceMs", Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  );
}

export default function SignalWatchCard() {
  const q = useQuery({ queryKey: ["io-watch"], queryFn: () => robotApi.ioWatch(), retry: 0 });
  const events = useRobot((s) => s.ioEvents);
  const [adding, setAdding] = useState(false);
  const [tracing, setTracing] = useState(false);

  // Live level and last edge per signal from the IO_EVENT stream.
  const live = useMemo(() => {
    const m = {};
    for (const e of [...events].reverse()) m[e.signal] = e;
    return m;
  }, [events]);

  const remove = async (name) => {
    await robotCall(() => robotApi.removeIoWatch(name));
    q.refetch();
  };
  const trace = async () => {
    setTracing(true);
    await robotCall(() => robotApi.ioTrace(60));
    setTimeout(() => setTracing(false), 60000);
  };

  const signals = q.data?.signals || [];
  return (
    <Card
      tut="io-watch"
      className="io-watch-card"
      title="Signal watch"
      subtitle="Logged input edges with timing and robot position"
      icon={Eye}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={Radio} loading={tracing} onClick={trace} title="Log every IO change for 60 s (for intermittent problems)">Trace 60 s</Button>
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)} disabled={q.isError}>Watch</Button>
        </>
      }
    >
      {q.isError ? (
        <Alert tone="warning">{q.error?.message || "The IO watch service is not running"}</Alert>
      ) : !signals.length ? (
        <EmptyState compact icon={Eye} title="No watched signals" text="Watch an input to log when it changes and for how long." />
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Input</th>
              <th className="center">Now</th>
              <th>Last change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => {
              const e = live[s.name];
              const level = e ? e.value : s.level === 1 ? true : s.level === 0 ? false : null;
              return (
                <tr key={s.name}>
                  <td><strong>{s.name}</strong></td>
                  <td className="small muted">{s.device} · {s.input.toUpperCase()}{s.debounceMs ? ` · ${s.debounceMs} ms` : ""}</td>
                  <td className="center"><StatusDot tone={level === null ? "off" : level ? "success" : "off"} size="lg" title={level === null ? "Unknown" : level ? "ON" : "OFF"} /></td>
                  <td className="small">
                    {e ? (
                      <>
                        <Badge tone={e.value || /^(rising|high)$/i.test(e.event) ? "success" : undefined}>{e.event}</Badge> {timeOf(e)}
                        <span className="xs muted"> after {e.wasFor} s · #{e.count}</span>
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <IconButton icon={Trash2} size="sm" label={`Stop watching ${s.name}`} onClick={() => remove(s.name)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <AddWatchModal open={adding} onClose={() => setAdding(false)} onAdded={() => q.refetch()} />
    </Card>
  );
}
