// Inputs of the program editor: numbers with units, presets and lock
// reasons; the offset editor. Every label carries its hover tip.
import { useEffect, useId, useState } from "react";
import { Lock } from "lucide-react";
import { cx } from "../../components/ui";
import { InfoTip, Tip, TipLabel } from "./Tip";

const fmt = (v) => (v === 0 || v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : String(Number(v)));

/**
 * Number field. 0 shows as empty (= "not set" for optional values) unless
 * `showZero`. `inherit` is shown as the placeholder ("0.5 from program").
 */
export function NumField({ label, tip, value, onChange, unit, min, max, step = "any", placeholder, inherit, disabled, lock, error, presets, showZero, autoFocus, className, required, wide }) {
  const id = useId();
  const [text, setText] = useState(showZero ? String(value ?? "") : fmt(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(showZero ? (value === "" || value === undefined ? "" : String(value)) : fmt(value));
  }, [value, focus, showZero]);
  const commit = (t) => {
    setText(t);
    if (t === "" || t === "-") return onChange(0);
    const n = Number(t);
    if (Number.isFinite(n)) onChange(n);
  };
  const outOfRange = Number.isFinite(Number(text)) && text !== "" && ((min !== undefined && Number(text) < min) || (max !== undefined && Number(text) > max));
  const locked = Boolean(lock);
  return (
    <div className={cx("field mp-field", wide && "span-2", className)}>
      {label && (
        <TipLabel label={label} tip={tip} htmlFor={id}>
          {locked && (
            <Tip text={lock}>
              <span className="mp-lock" tabIndex={0}>
                <Lock size={11} />
              </span>
            </Tip>
          )}
        </TipLabel>
      )}
      <div className={cx("mp-num", (error || outOfRange || (required && !Number(value))) && "is-invalid", (disabled || locked) && "is-disabled")}>
        <input
          id={id}
          className="mp-num-input"
          inputMode="decimal"
          value={locked ? "0" : text}
          placeholder={inherit !== undefined && inherit !== null && inherit !== "" ? `${inherit}` : placeholder}
          disabled={disabled || locked}
          autoFocus={autoFocus}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => commit(e.target.value.replace(",", "."))}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const inc = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const n = (Number(text) || 0) + (e.key === "ArrowUp" ? inc : -inc);
            commit(String(Math.round(n * 1000) / 1000));
          }}
          step={step}
        />
        {unit && <span className="mp-num-unit">{unit}</span>}
      </div>
      {presets && !locked && !disabled && (
        <div className="mp-presets">
          {presets.map((p) => {
            const v = typeof p === "object" ? p.value : p;
            const l = typeof p === "object" ? p.label : String(p);
            return (
              <Tip key={l} text={typeof p === "object" ? p.tip : undefined}>
                <button type="button" className={cx("mp-preset", Number(value) === v && "is-on")} onClick={() => commit(String(v))}>
                  {l}
                </button>
              </Tip>
            );
          })}
        </div>
      )}
      {error ? <span className="field-error">{error}</span> : outOfRange ? <span className="field-error">Allowed {min} to {max}</span> : null}
    </div>
  );
}

const OFFSET_PRESETS = [
  { label: "z +50", tip: "50 mm above (base z)", o: { z: 50 } },
  { label: "z +80", tip: "80 mm above", o: { z: 80 } },
  { label: "z +100", tip: "100 mm above", o: { z: 100 } },
  { label: "z +150", tip: "150 mm above", o: { z: 150 } },
  { label: "z −50", tip: "50 mm below", o: { z: -50 } },
];

/** x y z (mm) rx ry rz (deg) with quick presets. */
export function OffsetEditor({ value, onChange, error, relative }) {
  const o = value || { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  const set = (k, v) => onChange({ ...o, [k]: v });
  const [showRot, setShowRot] = useState(Boolean(o.rx || o.ry || o.rz));
  return (
    <div className={cx("mp-offset", error && "is-invalid")}>
      <div className="mp-offset-head">
        <span className="field-label mp-label">
          <span>{relative ? "Move by" : "Offset"}</span>
          <InfoTip
            title="Offset"
            text={relative ? "Relative move from where the previous step ended: x / y / z in mm, rx / ry / rz in degrees (turns the tool)." : "The target point shifted by x / y / z in mm and turned by rx / ry / rz in degrees, for example 80 mm above a pick point."}
          />
        </span>
        <div className="mp-presets">
          {OFFSET_PRESETS.map((p) => (
            <Tip key={p.label} text={p.tip}>
              <button type="button" className={cx("mp-preset", Number(o.z) === p.o.z && !o.x && !o.y && "is-on")} onClick={() => onChange({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...p.o })}>
                {p.label}
              </button>
            </Tip>
          ))}
        </div>
      </div>
      <div className="mp-offset-grid">
        {["x", "y", "z"].map((k) => (
          <NumField key={k} label={k} tip={`${k.toUpperCase()} shift in mm (±5000).`} value={o[k]} onChange={(v) => set(k, v)} unit="mm" min={-5000} max={5000} />
        ))}
      </div>
      {showRot ? (
        <div className="mp-offset-grid">
          {["rx", "ry", "rz"].map((k) => (
            <NumField key={k} label={k} tip={`Tool turned about ${k[1].toUpperCase()} in degrees (±360). Only turns the tool; the position comes from x / y / z.`} value={o[k]} onChange={(v) => set(k, v)} unit="°" min={-360} max={360} />
          ))}
        </div>
      ) : (
        <button type="button" className="mp-link" onClick={() => setShowRot(true)}>
          + turn the tool (rx / ry / rz)
        </button>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
