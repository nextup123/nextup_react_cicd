// GuidePanel -- cursor-aware reference: what the section under the cursor is, the keys of the
// rung type being written, the expression language, system bits; every example can be inserted.
import { useMemo } from "react";
import { SECTION_GUIDE, RUNG_KEYS, STEP_KEYS, EXPR_HELP, S_BITS, contextAt } from "./yamlGuide";
import { cx } from "../../components/ui";

export default function GuidePanel({ lines, cursorLine, onInsert, mode = "program" }) {
  const ctx = useMemo(() => contextAt(lines, cursorLine), [lines, cursorLine]);
  const sections = mode === "block" ? ["block", "description", "ports", "locals", "retain", "safe_state", "rungs", "sequences", "alarms"] : ["program", "scan_ms", "names", "io", "blocks", "retain", "safe_state", "rungs", "sequences", "alarms"];
  const present = new Set(lines.map((l) => (/^([A-Za-z_]+):/.exec(l) || [])[1]).filter(Boolean));
  const g = SECTION_GUIDE[ctx.section];
  return (
    <div className="guide col" style={{ gap: 12 }}>
      <div className="teacher-intro">
        {ctx.section ? <>Cursor in <b className="mono">{ctx.section}:</b>{ctx.rungType && <> — a <b className="mono">{ctx.rungType}</b> rung</>}{ctx.inStep && <> — a step</>}.</> : <>Put the cursor on a line and this panel explains the section and its keys.</>}
        {" "}Double-click a rung in the Form tab to edit it with a form; <b>Add a rung</b> builds one from dropdowns.
      </div>
      {g && (
        <section className="guide-sec is-current">
          <h3 className="mono">{g.title}</h3>
          <p className="small">{g.text}</p>
          <pre className="guide-ex">{g.example}</pre>
          {ctx.section === "rungs" && ctx.rungType && RUNG_KEYS[ctx.rungType] && <KeyTable title={`keys of a ${ctx.rungType} rung`} rows={RUNG_KEYS[ctx.rungType]} />}
          {ctx.section === "rungs" && !ctx.rungType && <div className="col" style={{ gap: 4 }}>{Object.entries(RUNG_KEYS).map(([t, rows]) => <details key={t}><summary className="small mono">{t}</summary><KeyTable rows={rows} /></details>)}</div>}
          {ctx.section === "sequences" && <KeyTable title="keys of a step" rows={STEP_KEYS} />}
        </section>
      )}
      <section className="guide-sec">
        <h3>Conditions (when, up, next, start …)</h3>
        <KeyTable rows={EXPR_HELP} />
      </section>
      <section className="guide-sec">
        <h3>System bits</h3>
        <KeyTable rows={S_BITS} />
      </section>
      <section className="guide-sec">
        <h3>Sections of the program</h3>
        <div className="col" style={{ gap: 4 }}>
          {sections.map((s) => (
            <div key={s} className={cx("guide-row", present.has(s) && "present")}>
              <b className="mono">{s}:</b>
              <span className="xs muted grow">{SECTION_GUIDE[s].text.split(".")[0]}.</span>
              {!present.has(s) && <button className="btn sm ghost" onClick={() => onInsert(SECTION_GUIDE[s].example)}>insert</button>}
            </div>
          ))}
        </div>
        <p className="xs muted">Unknown sections or keys are errors (typo protection). Memory map: joint1..6.di1..di8 (di6..di8 = STO1, STO2, EDM) and gpio1.di1..di8 as inputs; joint1..6.do1..do3 + pi_p and gpio1.do1..do8 as outputs; M0..M127; R0..R31. Only outputs written in the program are controlled; the rest stay free for the robot program.</p>
      </section>
    </div>
  );
}
function KeyTable({ title, rows }) {
  return (
    <table className="grid" style={{ marginTop: 6 }}>
      {title && <thead><tr><th colSpan={2}>{title}</th></tr></thead>}
      <tbody>{rows.map(([k, v]) => <tr key={k}><td className="mono" style={{ whiteSpace: "nowrap" }}>{k}</td><td className="small">{v}</td></tr>)}</tbody>
    </table>
  );
}
