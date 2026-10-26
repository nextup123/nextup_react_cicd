import { Cpu } from "lucide-react";
import { Badge, Card, StatusDot, Switch } from "../../components/ui";
import { plcIoName, usePlcIoUsage } from "../../lib/plcIoUsage";
import { PlcMark, PlcLegend, withPlc } from "./PlcMark";
import { useRobot } from "../../store/robot";
import { setDriverDo, useDriverDi, useDriverDo } from "./ioLive";
import { DoReachDot } from "./DoReachDot";

const DRIVERS = [1, 2, 3, 4, 5, 6];
const DI_ROWS = [1, 2, 3, 4, 5];
const DO_ROWS = [
  { n: 1, label: "DO1" },
  { n: 2, label: "DO2" },
  { n: 3, label: "DO3" },
  { n: 4, label: "PI_P", hint: "PI_P output (sent as DO 4)" },
];

function DiCell({ driver, n, use }) {
  const { on, known } = useDriverDi(driver, n);
  return (
    <td className="center">
      <PlcMark use={use}>
        <span className={known ? "io-led" : "io-led is-stale"} title={withPlc(`Driver ${driver} · DI${n}: ${known ? (on ? "ON" : "OFF") : "no data yet"}`, use)}>
          <StatusDot tone={on ? "success" : "off"} size="lg" />
        </span>
      </PlcMark>
    </td>
  );
}

function DoCell({ driver, n, label, use }) {
  const { on, actual, pending } = useDriverDo(driver, n);
  return (
    <td className="center">
      <PlcMark use={use} className="io-do-cell">
        <Switch
          size="sm"
          tone="success"
          checked={on}
          onChange={(v) => setDriverDo(driver, n, v)}
          title={withPlc(`Driver ${driver} · ${label}: switch ${on ? "off" : "on"}`, use)}
        />
        <DoReachDot kind="driver" a={driver} n={n} actual={actual} pending={pending} label={`Driver ${driver} · ${label}`} />
      </PlcMark>
    </td>
  );
}

/** Live driver inputs (DI1..DI5) and outputs (DO1..DO3, PI_P) for drivers 1..6. */
export default function DriverIoCard() {
  const hasDi = useRobot((s) => s.diStatus.length > 0);
  const plc = usePlcIoUsage();
  return (
    <Card
      tut="io-driver"
      title="Driver I/O"
      subtitle="Live inputs and outputs of the six joint drivers"
      icon={Cpu}
      actions={hasDi ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Waiting for data</Badge>}
      flush
    >
      <div className="io-matrix">
        <table className="table compact">
          <thead>
            <tr>
              <th>Inputs</th>
              {DRIVERS.map((d) => (
                <th key={d} className="center" title={`Driver ${d}`}>D{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DI_ROWS.map((n) => (
              <tr key={n}>
                <td className="strong">DI{n}</td>
                {DRIVERS.map((d) => (
                  <DiCell key={d} driver={d} n={n} use={plc[plcIoName({ driver: d, kind: "di", n })]} />
                ))}
              </tr>
            ))}
          </tbody>
          <thead>
            <tr>
              <th>Outputs</th>
              {DRIVERS.map((d) => (
                <th key={d} className="center" title={`Driver ${d}`}>D{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DO_ROWS.map((r) => (
              <tr key={r.n}>
                <td className="strong" title={r.hint}>{r.label}</td>
                {DRIVERS.map((d) => (
                  <DoCell key={d} driver={d} n={r.n} label={r.label} use={plc[plcIoName({ driver: d, kind: "do", n: r.n })]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="io-legend xs muted">
        Green = on. Outputs: switch = command, dot = what reached the controller (amber = waiting, red = not accepted).
        <PlcLegend usage={plc} />
      </div>
    </Card>
  );
}
