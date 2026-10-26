// Editor of one step. The motion and its "defined by" form decide which
// fields exist at all, so a step can only be built from keys its motion
// accepts (programRules.FORMS); values that still fit survive a change of
// motion. Locked fields say why they are locked.
import { AlertTriangle, CircleAlert, Copy, Trash2, Wand2 } from "lucide-react";
import { Button, IconButton, Input, Segmented, Switch, cx } from "../../components/ui";
import {
  FORMS, MOTIONS, MOTION_INFO, ORIENTATIONS, OFFSET_FRAMES, TIPS, WEAVE_SHAPES, WEAVE_TIPS,
  allowedKeys, applyForm, blendLockReason, detectForm, formOf, orientationAllowed, weaveAllowed,
} from "./programRules";
import { MotionGlyph, WeaveGlyph } from "./glyphs";
import { NumField, OffsetEditor } from "./fields";
import { PointListPicker, PointPicker } from "./PointPicker";
import { Tip, TipLabel } from "./Tip";

const POINT_LABEL = {
  "PTP:point": "Target point",
  "PTP:point_offset": "Point",
  "LIN:point": "Target point",
  "LIN:point_offset": "Point",
  "CIRC:via": "End point",
  "CIRC:center_point": "End point",
  "CIRCLE:via": "Third point",
};

const ANGLE_PRESETS = {
  "CIRC:via": [{ value: 0, label: "to end", tip: "Stop at the end point (no extra sweep)." }, 180, 270, 360],
  "CIRC:center_angle": [90, 180, -90, -180],
  "CIRCLE:via": [{ value: 0, label: "360", tip: "One full circle (default)." }, 380, 400, 720],
  "CIRCLE:center_radius": [{ value: 0, label: "360", tip: "One full circle (default)." }, 380, 720, -360],
};

function speedHint(v) {
  const n = Number(v);
  if (!n) return null;
  return n < 1 ? `${Math.round(n * 1000 * 10) / 10} mm/s` : null;
}

export default function StepInspector({ step, index, steps, program, points, issues, onChange, onDelete, onDuplicate, onFix }) {
  const form = detectForm(step);
  const f = formOf(step.motion, form);
  const allowed = allowedKeys(step, form);
  const key = `${step.motion}:${form}`;
  const fieldErr = (field) => issues.find((i) => i.field === field && i.level === "error")?.message;
  const set = (patch, k) => onChange(patch, k);
  const lock = blendLockReason(steps, index);
  const progSpeed = Number(program.speed_mps) ? `${program.speed_mps} (program)` : "goto default";
  const progAcc = Number(program.acceleration_mps2) ? `${program.acceleration_mps2} (program)` : "goto default";
  const first = index === 0;

  const changeMotion = (m) => {
    if (m === step.motion) return;
    const forms = FORMS[m];
    // keep the same kind of form when the new motion has it, else its first
    const target = forms.find((x) => x.id === form) || forms[0];
    set(applyForm(step, m, target.id));
  };

  return (
    <div className="mp-inspector" data-tut="mp-insp">
      <div className="mp-insp-head" data-tut="mp-insp-head">
        <span className="mp-insp-num">Step {index + 1}</span>
        <span className="grow" />
        <IconButton size="sm" icon={Copy} label="Duplicate step (Ctrl+D)" onClick={onDuplicate} />
        <IconButton size="sm" icon={Trash2} label="Delete step (Del)" onClick={onDelete} />
      </div>

      {issues.length > 0 && (
        <div className="mp-insp-issues" data-tut="mp-insp-issues">
          {issues.map((i, k) => (
            <div key={k} className={cx("mp-issue", i.level === "error" ? "is-error" : "is-warn")}>
              {i.level === "error" ? <CircleAlert size={14} /> : <AlertTriangle size={14} />}
              <span className="grow">{i.message}</span>
              {i.fix && (
                <Button size="sm" variant="soft" icon={Wand2} onClick={() => onFix(i.fix)}>
                  {i.fix.label}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* motion */}
      <div className="mp-section">
        <TipLabel label="Motion" tip={TIPS.motion} />
        <div className="mp-motions" data-tut="mp-motions" role="radiogroup" aria-label="Motion">
          {MOTIONS.map((m) => {
            const disabled = first && m !== "PTP" && m !== "LIN";
            return (
              <Tip key={m} title={`${m} · ${MOTION_INFO[m].name}`} text={disabled ? `${MOTION_INFO[m].tip}\n\nNot as the first step: a program starts with a PTP or LIN to a point.` : MOTION_INFO[m].tip}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={step.motion === m}
                  className={cx("mp-motion", `mot-${m.toLowerCase()}`, step.motion === m && "is-on")}
                  disabled={disabled}
                  onClick={() => changeMotion(m)}
                >
                  <MotionGlyph motion={m} />
                  <span className="mp-motion-code">{m}</span>
                  <span className="mp-motion-name">{MOTION_INFO[m].name}</span>
                </button>
              </Tip>
            );
          })}
        </div>
      </div>

      {FORMS[step.motion].length > 1 && (
        <div className="mp-section" data-tut="mp-form">
          <TipLabel label="Defined by" tip={TIPS.form} />
          <div className="mp-forms">
            {FORMS[step.motion].map((x) => {
              const disabled = first && x.id === "relative";
              return (
                <Tip key={x.id} text={disabled ? `${x.tip} Not allowed as the first step.` : x.tip}>
                  <button type="button" className={cx("mp-form", form === x.id && "is-on")} disabled={disabled} onClick={() => form !== x.id && set(applyForm(step, step.motion, x.id))}>
                    {x.label}
                  </button>
                </Tip>
              );
            })}
          </div>
        </div>
      )}

      {/* geometry */}
      <div className="mp-section mp-grid2" data-tut="mp-geometry">
        {allowed.has("via") && (
          <div className="field">
            <TipLabel label="Via point" tip={TIPS.via} />
            <PointPicker value={step.via} points={points} invalid={fieldErr("via")} onChange={(v) => set({ via: v })} />
          </div>
        )}
        {allowed.has("center") && (
          <div className="field">
            <TipLabel label="Centre point" tip={TIPS.center} />
            <PointPicker value={step.center} points={points} invalid={fieldErr("center")} onChange={(v) => set({ center: v })} />
          </div>
        )}
        {allowed.has("point") && (
          <div className="field" data-tut="mp-point">
            <TipLabel label={POINT_LABEL[key] || "Point"} tip={step.weave && step.motion === "LIN" ? `${TIPS.point} For a weave this is the seam end.` : TIPS.point} />
            <PointPicker value={step.point} points={points} invalid={fieldErr("point")} onChange={(v) => set({ point: v })} />
          </div>
        )}
        {allowed.has("points") && (
          <div className="field span-2">
            <TipLabel label="Through points" tip={TIPS.points} />
            <PointListPicker value={step.points} points={points} invalid={fieldErr("points")} onChange={(v) => set({ points: v })} />
          </div>
        )}
        {allowed.has("radius_mm") && (
          <NumField label="Radius" tip={TIPS.radius_mm} value={step.radius_mm} onChange={(v) => set({ radius_mm: v }, "radius")} unit="mm" min={1} max={5000} required error={fieldErr("radius_mm")} presets={[10, 25, 50, 100]} />
        )}
        {allowed.has("start_radius_mm") && (
          <NumField label="Start radius" tip={TIPS.start_radius_mm} value={step.start_radius_mm} onChange={(v) => set({ start_radius_mm: v }, "srad")} unit="mm" min={0} max={5000} placeholder="0 = centre" error={fieldErr("start_radius_mm")} />
        )}
        {allowed.has("turns") && (
          <NumField label="Turns" tip={TIPS.turns} value={step.turns} onChange={(v) => set({ turns: v }, "turns")} min={-200} max={200} required error={fieldErr("turns")} presets={[1, 3, 6, -3]} />
        )}
        {allowed.has("pitch_mm") && (
          <NumField label="Pitch (helix)" tip={TIPS.pitch_mm} value={step.pitch_mm} onChange={(v) => set({ pitch_mm: v }, "pitch")} unit="mm/turn" min={-500} max={500} placeholder="0 = flat" error={fieldErr("pitch_mm")} />
        )}
        {allowed.has("angle_deg") && (
          <NumField
            label={step.motion === "CIRCLE" ? "Sweep" : form === "center_angle" ? "Angle" : "Keep going"}
            tip={TIPS.angle_deg}
            value={step.angle_deg}
            onChange={(v) => set({ angle_deg: v }, "angle")}
            unit="°"
            min={form === "via" ? 0 : -3600}
            max={3600}
            required={form === "center_angle"}
            placeholder={step.motion === "CIRCLE" ? "360" : form === "via" ? "to the end point" : ""}
            error={fieldErr("angle_deg")}
            presets={ANGLE_PRESETS[key]}
          />
        )}
      </div>

      {allowed.has("offset") && (
        <div className="mp-section" data-tut="mp-offset">
          <OffsetEditor value={step.offset} relative={form === "relative"} error={fieldErr("offset")} onChange={(o) => set({ offset: o }, "offset")} />
          {allowed.has("offset_frame") && (
            <div className="mp-row">
              <TipLabel label="Offset in" tip={TIPS.offset_frame} />
              <Segmented size="sm" value={step.offset_frame || ""} onChange={(v) => set({ offset_frame: v })} options={OFFSET_FRAMES.map((o) => ({ value: o.value, label: o.label, title: o.tip }))} />
            </div>
          )}
        </div>
      )}

      {(allowed.has("orientation") || allowed.has("weave")) && (
        <div className="mp-section" data-tut="mp-orient">
          {allowed.has("orientation") && (
            <div className="mp-row">
              <TipLabel label="Tool orientation" tip={TIPS.orientation} />
              <div className="mp-forms">
                {ORIENTATIONS.map((o) => {
                  const ok = orientationAllowed(step, o.value);
                  return (
                    <Tip key={o.value || "def"} text={ok ? o.tip : `${o.tip} (not possible for this motion)`}>
                      <button type="button" className={cx("mp-form", (step.orientation || "") === o.value && "is-on")} disabled={!ok} onClick={() => set({ orientation: o.value })}>
                        {o.label}
                      </button>
                    </Tip>
                  );
                })}
              </div>
            </div>
          )}
          {allowed.has("weave") && weaveAllowed(step) && (
            <div className="mp-weave">
              <div className="mp-row">
                <TipLabel label="Weave" tip={TIPS.weave} />
                <Switch
                  size="sm"
                  checked={Boolean(step.weave)}
                  onChange={(on) => set({ weave: on ? { shape: "sine", amplitude_mm: 3, wavelength_mm: 5 } : null })}
                  label={step.weave ? "On" : "Off"}
                />
              </div>
              {step.weave && (
                <>
                  <div className="mp-shapes">
                    {WEAVE_SHAPES.filter((s) => s !== "zigzag" || step.weave.shape === "zigzag").map((s) => (
                      <Tip key={s} title={s} text={WEAVE_TIPS[s]}>
                        <button type="button" className={cx("mp-shape", step.weave.shape === s && "is-on")} onClick={() => set({ weave: { ...step.weave, shape: s } })}>
                          <WeaveGlyph shape={s} />
                          <span>{s}</span>
                        </button>
                      </Tip>
                    ))}
                  </div>
                  <div className="mp-grid2">
                    <NumField label="Amplitude" tip={TIPS.amplitude_mm} value={step.weave.amplitude_mm} onChange={(v) => set({ weave: { ...step.weave, amplitude_mm: v } }, "amp")} unit="mm" min={0} max={50} required error={fieldErr("amplitude_mm")} presets={[1, 2, 3, 5]} />
                    <NumField label="Wavelength" tip={TIPS.wavelength_mm} value={step.weave.wavelength_mm} onChange={(v) => set({ weave: { ...step.weave, wavelength_mm: v } }, "wl")} unit="mm" min={0} max={100} required error={fieldErr("wavelength_mm")} presets={[3, 5, 8, 10]} />
                  </div>
                </>
              )}
            </div>
          )}
          {allowed.has("weave") && !weaveAllowed(step) && step.motion === "LIN" && <div className="small muted">Weave needs a straight line to a point without an offset (the seam end).</div>}
        </div>
      )}

      {/* speeds and stops */}
      <div className="mp-section mp-grid2" data-tut="mp-speeds">
        <NumField
          label="Speed"
          tip={TIPS.speed_mps}
          value={step.speed_mps}
          onChange={(v) => set({ speed_mps: v }, "speed")}
          unit="m/s"
          min={0}
          max={10}
          inherit={progSpeed}
          error={fieldErr("speed_mps")}
          presets={[0.02, 0.05, 0.1, 0.25, 0.5, 1]}
        />
        <NumField label="Acceleration" tip={TIPS.acceleration_mps2} value={step.acceleration_mps2} onChange={(v) => set({ acceleration_mps2: v }, "acc")} unit="m/s²" min={0} max={50} inherit={progAcc} error={fieldErr("acceleration_mps2")} />
        <NumField
          label="Blend"
          tip={TIPS.blend_mm}
          value={step.blend_mm}
          onChange={(v) => set({ blend_mm: v }, "blend")}
          unit="mm"
          min={0}
          max={1000}
          lock={!Number(step.blend_mm) ? lock : null}
          placeholder="0 = stop at the point"
          error={fieldErr("blend_mm")}
          presets={lock ? null : [0, 10, 20, 50, 100]}
        />
        <NumField label="Dwell" tip={TIPS.dwell_s} value={step.dwell_s} onChange={(v) => set(v > 0 ? { dwell_s: v, blend_mm: 0 } : { dwell_s: v }, "dwell")} unit="s" min={0} max={3600} placeholder="no wait" error={fieldErr("dwell_s")} presets={[0.2, 0.5, 1, 2]} />
        {speedHint(step.speed_mps) && <div className="mp-hint span-2">{speedHint(step.speed_mps)} tool speed</div>}
      </div>

      <div className="mp-section" data-tut="mp-note">
        <TipLabel label="Note" tip={TIPS.note} />
        <Input size="sm" value={step.note || ""} placeholder="e.g. BT: gripper closes" maxLength={160} onChange={(e) => set({ note: e.target.value }, "note")} />
      </div>
      {f && <div className="mp-formtip small muted">{f.tip}</div>}
    </div>
  );
}
