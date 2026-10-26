import { useEffect } from "react";
import { CircuitBoard, RefreshCw } from "lucide-react";
import { Badge, Card, EmptyState, IconButton, StatusDot, Switch } from "../../components/ui";
import { plcIoName, usePlcIoUsage } from "../../lib/plcIoUsage";
import { PlcLegend, PlcMark, withPlc } from "./PlcMark";
import { useRobot } from "../../store/robot";
import { requestGpioState, setGpioDo, useGpioDi, useGpioDo } from "./ioLive";
import { DoReachDot } from "./DoReachDot";

const CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8];

function DiCell({ group, n, use }) {
  const { on, known } = useGpioDi(group, n);
  return (
    <td className="center">
      <PlcMark use={use}>
        <span className={known ? "io-led" : "io-led is-stale"} title={withPlc(`${group} · DI${n}: ${known ? (on ? "ON" : "OFF") : "not reported"}`, use)}>
          <StatusDot tone={on ? "success" : "off"} size="lg" />
        </span>
      </PlcMark>
    </td>
  );
}

function DoCell({ group, n, use }) {
  const { on, actual, pending } = useGpioDo(group, n);
  return (
    <td className="center">
      <PlcMark use={use} className="io-do-cell">
        <Switch size="sm" tone="success" checked={on} onChange={(v) => setGpioDo(group, n, v)} title={withPlc(`${group} · DO${n}: switch ${on ? "off" : "on"}`, use)} />
        <DoReachDot kind="gpio" a={group} n={n} actual={actual} pending={pending} label={`${group} · DO${n}`} />
      </PlcMark>
    </td>
  );
}

function Matrix({ groups, kind, plc }) {
  const isDo = kind === "do";
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>{isDo ? "Outputs" : "Inputs"}</th>
          {CHANNELS.map((n) => (
            <th key={n} className="center">
              {isDo ? "DO" : "DI"}
              {n}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g}>
            <td className="strong">{g}</td>
            {CHANNELS.map((n) => {
              const use = plc[plcIoName({ gpio: g, kind, n })];
              return isDo ? <DoCell key={n} group={g} n={n} use={use} /> : <DiCell key={n} group={g} n={n} use={use} />;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Live GPIO groups (DI1..8 and DO1..8 per group) reported by the GPIO controller. */
export default function GpioCard() {
  const groupKey = useRobot((s) => Object.keys(s.gpio).join("|"));
  const groups = groupKey ? groupKey.split("|") : [];
  const plc = usePlcIoUsage();

  useEffect(() => {
    requestGpioState();
  }, []);

  return (
    <Card
      tut="io-gpio"
      title="GPIO I/O"
      subtitle="Live channels of the GPIO modules"
      icon={CircuitBoard}
      actions={
        <>
          {groups.length > 0 ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Waiting for data</Badge>}
          <IconButton icon={RefreshCw} label="Ask the robot for the GPIO state" size="sm" onClick={requestGpioState} />
        </>
      }
      flush
    >
      {groups.length === 0 ? (
        <EmptyState compact icon={CircuitBoard} title="Waiting for GPIO state…" text="Groups appear here as soon as the GPIO controller reports them." />
      ) : (
        <div className="io-matrix">
          <Matrix groups={groups} kind="di" plc={plc} />
          <Matrix groups={groups} kind="do" plc={plc} />
          {Object.keys(plc).length > 0 && <div className="io-legend xs muted"><PlcLegend usage={plc} /></div>}
        </div>
      )}
    </Card>
  );
}
