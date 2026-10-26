// The live control for one IO sequence step: a switch or push button for an
// output, an indicator for an input. Used in the IO list and in the floating
// controls that can be pinned over every page.
import { useState } from "react";
import { Hand } from "lucide-react";
import { Button, StatusDot, Switch, cx } from "../../components/ui";
import { doIdToNumber, pushListDo, setListDo, useDriverDi, useDriverDo, useGpioDi, useGpioDo } from "./ioLive";
import { isGpio, isOutput } from "./ioApi";
import { DoReachDot } from "./DoReachDot";
import { PlcMark, withPlc } from "./PlcMark";
import { plcIoName, usePlcIoUsage } from "../../lib/plcIoUsage";

/** PLC address of an IO sequence step (joint2.do1, gpio1.di3, joint1.pi_p). */
export function seqPlcName(seq) {
  const out = isOutput(seq);
  const n = out ? doIdToNumber(seq.doId) : parseInt(seq.diId, 10);
  return isGpio(seq) ? plcIoName({ gpio: seq.gpioId, kind: out ? "do" : "di", n }) : plcIoName({ driver: seq.driverId, kind: out ? "do" : "di", n });
}

/** IO sequence step -> /ros/do-list style item used by setListDo / pushListDo. */
export function seqToIo(seq) {
  return isGpio(seq)
    ? { type: "gpio", gpio_id: seq.gpioId, do_id: seq.doId, di_id: seq.diId, push_wait: seq.pushWait }
    : { type: "driver", driver_id: seq.driverId, do_id: seq.doId, di_id: seq.diId, push_wait: seq.pushWait };
}

function useOutputState(seq) {
  const gpio = isGpio(seq);
  // Both hooks always run (hook order); only the relevant one is used.
  const d = useDriverDo(gpio ? 0 : seq.driverId, gpio ? 0 : doIdToNumber(seq.doId));
  const g = useGpioDo(gpio ? seq.gpioId : "", gpio ? parseInt(seq.doId, 10) : 0);
  return gpio ? g : d;
}

function useInputState(seq) {
  const gpio = isGpio(seq);
  const d = useDriverDi(gpio ? 0 : seq.driverId, gpio ? 0 : parseInt(seq.diId, 10));
  const g = useGpioDi(gpio ? seq.gpioId : "", gpio ? parseInt(seq.diId, 10) : 0);
  return gpio ? g : d;
}

function OutputControl({ seq, compact, use }) {
  const { on, actual, pending } = useOutputState(seq);
  const [pushing, setPushing] = useState(false);
  const item = seqToIo(seq);
  const gpio = isGpio(seq);
  const feedback = gpio
    ? <DoReachDot kind="gpio" a={seq.gpioId} n={parseInt(seq.doId, 10)} actual={actual} pending={pending} label={seq.name} />
    : <DoReachDot kind="driver" a={seq.driverId} n={doIdToNumber(seq.doId)} actual={actual} pending={pending} label={seq.name} />;

  if (seq.controlType === "push") {
    return (
      <span className="io-ctl">
        <Button
          size="sm"
          variant={pushing ? "success" : "default"}
          icon={Hand}
          className={cx("io-push", compact && "is-compact")}
          title={withPlc(`Push: on for ${parseInt(seq.pushWait, 10) || 250} ms, then off`, use)}
          onClick={async () => {
            setPushing(true);
            try {
              await pushListDo(item);
            } finally {
              setPushing(false);
            }
          }}
        >
          {compact ? null : "Push"}
        </Button>
        {feedback}
      </span>
    );
  }
  return (
    <span className="io-ctl">
      <Switch size="sm" tone="success" checked={on} onChange={(v) => setListDo(item, v)} title={withPlc(`Switch ${seq.name} ${on ? "off" : "on"}`, use)} />
      {feedback}
    </span>
  );
}

function InputIndicator({ seq, compact, use }) {
  const { on, known } = useInputState(seq);
  return (
    <span className={cx("io-ctl io-in", on && "is-on", !known && "is-stale")} title={withPlc(`${seq.name}: ${known ? (on ? "ON" : "OFF") : "no data yet"}`, use)}>
      <StatusDot tone={on ? "success" : "off"} size="lg" />
      {!compact && <span className="io-in-text">{known ? (on ? "ON" : "OFF") : "—"}</span>}
    </span>
  );
}

export function IoLiveControl({ seq, compact = false }) {
  const use = usePlcIoUsage()[seqPlcName(seq)];
  const ctl = isOutput(seq) ? <OutputControl seq={seq} compact={compact} use={use} /> : <InputIndicator seq={seq} compact={compact} use={use} />;
  return use ? <PlcMark use={use} className="io-plc-ctl">{ctl}</PlcMark> : ctl;
}
