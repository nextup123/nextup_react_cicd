// Program-level keys: name, description, repeat, default speed and
// acceleration, tool and frame (the last two are saved but not used by the
// motion server yet).
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input, cx } from "../../components/ui";
import { NAME_RE, TIPS } from "./programRules";
import { NumField } from "./fields";
import { PointPicker } from "./PointPicker";
import { TipLabel } from "./Tip";

const TOOLS = ["gripper", "vacuum", "torch", "spindle", "spray_gun", "dispenser", "polisher", "deburr_spindle"];

export default function ProgramSettings({ program, points, issues, onChange, nameTaken }) {
  const [more, setMore] = useState(Boolean(program.tool || program.frame));
  const nameErr = !program.name ? "A name is needed" : !NAME_RE.test(program.name) ? "Letters, digits, _ and - only (up to 64)" : nameTaken ? "Another program has this name" : null;
  const err = (f) => issues.find((i) => i.step === null && i.field === f && i.level === "error")?.message;
  return (
    <div className="mp-settings" data-tut="mp-settings">
      <div className="mp-settings-row">
        <div className="field mp-name" data-tut="mp-name">
          <TipLabel label="Name" tip={TIPS.name} />
          <Input size="sm" value={program.name} invalid={Boolean(nameErr)} onChange={(e) => onChange({ name: e.target.value.replace(/\s+/g, "_") }, "name")} spellCheck={false} />
          {nameErr && <span className="field-error">{nameErr}</span>}
        </div>
        <div className="field grow" data-tut="mp-desc">
          <TipLabel label="Description" tip={TIPS.description} />
          <Input size="sm" value={program.description} placeholder="What the program does" onChange={(e) => onChange({ description: e.target.value }, "desc")} />
        </div>
      </div>
      <div className="mp-settings-row" data-tut="mp-numbers">
        <NumField
          label="Repeat"
          tip={TIPS.repeat}
          value={program.repeat}
          showZero
          onChange={(v) => onChange({ repeat: Math.max(0, Math.round(v)) }, "repeat")}
          min={0}
          error={err("repeat")}
          presets={[{ value: 1, label: "once" }, 2, 5, { value: 0, label: "∞", tip: "Until finish_program or stop. A RunProgram node in a tree refuses this." }]}
          className="mp-w-repeat"
        />
        <NumField label="Speed" tip={TIPS.program_speed} value={program.speed_mps} onChange={(v) => onChange({ speed_mps: v }, "pspeed")} unit="m/s" min={0} max={10} placeholder="goto default" presets={[0.1, 0.25, 0.5, 1]} />
        <NumField label="Acceleration" tip={TIPS.program_acc} value={program.acceleration_mps2} onChange={(v) => onChange({ acceleration_mps2: v }, "pacc")} unit="m/s²" min={0} max={50} placeholder="goto default" presets={[0.5, 1, 2, 3]} />
      </div>
      <button type="button" className="mp-link" data-tut="mp-more" onClick={() => setMore((m) => !m)}>
        {more ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Tool and frame {program.tool || program.frame ? `(${[program.tool, program.frame].filter(Boolean).join(", ")})` : ""}
      </button>
      {more && (
        <div className={cx("mp-settings-row")} data-tut="mp-toolframe">
          <div className="field">
            <TipLabel label="Tool (TCP)" tip={TIPS.tool} />
            <Input size="sm" list="mp-tools" value={program.tool} placeholder="e.g. gripper" onChange={(e) => onChange({ tool: e.target.value.trim() }, "tool")} />
            <datalist id="mp-tools">
              {TOOLS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <TipLabel label="Frame" tip={TIPS.frame} />
            <PointPicker value={program.frame} points={points} onlyFrames clearable placeholder="base (default)" onChange={(v) => onChange({ frame: v })} />
          </div>
          <div className="mp-hint">Saved in the file; the motion server does not use tool and frame yet.</div>
        </div>
      )}
    </div>
  );
}
