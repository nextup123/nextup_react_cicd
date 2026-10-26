// "Used by PLC" mark around an IO control: a blue ring when the PLC program reads
// the signal, an amber ring when it drives the output (a manual change is
// overwritten on the next scan). The tooltip says where the program uses it.
import { Cpu } from "lucide-react";
import { cx } from "../../components/ui";
import { plcUseText } from "../../lib/plcIoUsage";

export const withPlc = (title, use) => (use ? `${title}\n\n${plcUseText(use)}` : title);

export function PlcMark({ use, className, children }) {
  return (
    <span className={cx("io-plc", use && (use.driven ? "is-driven" : "is-read"), className)}>
      {children}
      {use && <span className="io-plc-tag" aria-label="Used by the PLC program">PLC</span>}
    </span>
  );
}

/** Legend line, shown only when the program uses at least one signal (or `always`). */
export function PlcLegend({ usage, always }) {
  const n = Object.keys(usage || {}).length;
  if (!n && !always) return null;
  return (
    <span className="io-plc-legend">
      <Cpu size={12} />
      <span><span className="io-plc-key is-read">PLC</span> read by the PLC program</span>
      <span><span className="io-plc-key is-driven">PLC</span> driven by the PLC (manual changes get overwritten)</span>
    </span>
  );
}
