// Shared bits for record tables: the extra fields of a record as small
// "key value" chips, and the full record as a key / value grid (every field
// exactly as the node wrote it).
import { Fragment } from "react";

const LABELS = {
  request_id: "request id",
  request: "request",
  result: "result",
  cause: "cause",
  file: "file",
  failure: "failure",
  code: "code",
  statusword: "statusword",
  last_error: "last error",
  previous_error: "previous error",
  code_hex: "code",
  was_for_s: "held before (s)",
  positions_deg: "positions (°)",
  motion_id: "motion id",
  speed_mps: "speed (m/s)",
  acceleration_mps2: "acceleration (m/s²)",
  speed_scale: "speed scale (%)",
  duration_s: "duration (s)",
  dry_run: "dry run",
};
export const fieldLabel = (k) => LABELS[k] || k.replace(/_/g, " ");

export function fieldText(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? Number(x.toFixed?.(3) ?? x) : x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/** Extra fields (not in the table's columns) as chips. */
export function ExtraChips({ extra, skip = [], detail = "" }) {
  // a value already written out in the detail text (cause, file) is not repeated
  const list = Object.entries(extra || {}).filter(([k, v]) => !skip.includes(k) && !(detail && String(v).length > 3 && String(detail).includes(String(v))));
  if (!list.length) return null;
  return (
    <span className="dg-extra">
      {list.map(([k, v]) => (
        <span key={k} className="dg-chip" title={`${fieldLabel(k)}: ${fieldText(v)}`}>
          <span className="dg-chip-k">{fieldLabel(k)}</span>
          <span className="dg-chip-v">{fieldText(v)}</span>
        </span>
      ))}
    </span>
  );
}

/** Every field of a record. */
export function FieldList({ fields }) {
  const list = Object.entries(fields || {}).filter(([k, v]) => v !== undefined && v !== null && v !== "" && k !== "extra" && k !== "fields");
  if (!list.length) return null;
  return (
    <div className="dg-fields">
      {list.map(([k, v]) => (
        <Fragment key={k}>
          <span className="dg-field-k">{fieldLabel(k)}</span>
          <span className="dg-field-v mono">{fieldText(v)}</span>
        </Fragment>
      ))}
    </div>
  );
}
