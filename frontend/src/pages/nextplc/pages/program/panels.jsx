// The right-hand panels of the Program page: Teacher, Ladder, YAML, Outline.
import { useMemo } from "react";
import { usePlc } from "../../store/plc";
import { cx } from "../../components/ui";

/** read(name) over the live state, for the ladder editor: raw addresses, the program's names, seq.* */
export function useNameRead(enabled, described) {
  const state = usePlc((s) => s.state);
  return useMemo(() => {
    if (!enabled || !state) return null;
    const alias = new Map((described?.aliases || state.aliases || []).map((a) => [a.alias.toLowerCase(), a.target]));
    const seqs = new Map(state.seqs.map((s) => [s.name.toLowerCase(), s]));
    return (name) => {
      const n = String(name || "").trim();
      const canon = alias.get(n.toLowerCase()) || n;
      const lower = canon.toLowerCase();
      if (lower.startsWith("seq.")) {
        const [, sn, what] = lower.split(".");
        const s = seqs.get(sn);
        if (!s) return 0;
        return what === "step" ? s.step : what === "active" ? s.step > 0 : s.step_name.toLowerCase() === what;
      }
      if (/^r\d+$/i.test(canon)) return state.regs[canon.toUpperCase()] ?? 0;
      const direct = state.bits[canon];
      if (direct !== undefined) return direct;
      const key = Object.keys(state.bits).find((k) => k.toLowerCase() === lower);
      return key ? state.bits[key] : 0;
    };
  }, [enabled, state, described]);
}

function Lesson({ item, kind, live }) {
  return (
    <div className="lesson-item">
      <h4><span className={cx("type", kind || item.type)}>{(kind || item.type).toUpperCase()}</span>{item.title}{live !== undefined && <span className={cx("pill", live ? "on" : "")} style={{ marginLeft: "auto" }}>{live ? "TRUE now" : "false now"}</span>}</h4>
      <ul>{item.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

/** The teacher: every source line read back, the cursor line highlighted. */
export function TeacherPanel({ described, lines, cursorLine, onGoLine, liveRungs }) {
  if (!described) return <div className="teacher"><div className="teacher-intro">Write a rung and it is explained here, line by line: which bits are read, what is written and when. Fix the error shown under the editor first.</div></div>;
  const lessons = described.explain;
  return (
    <div className="teacher">
      <div className="teacher-intro">
        Every <b>10 ms</b> the PLC reads the inputs, runs these rungs from the top to the bottom, runs the sequences, then writes the outputs that changed. This program controls <b>{described.controls.length}</b> of 32 outputs ({described.controls.join(", ") || "none"}); every other output stays free for the robot program.
        {described.has_emergency && <> It contains an <b>EMERGENCY</b> rung.</>}
      </div>
      {lessons.map((l) => (
        <div key={l.line} className={cx("lesson", l.line === cursorLine && "is-current")} id={`lesson-${l.line}`}>
          <div className="lesson-src" onClick={() => onGoLine(l.line)}><span className="n">{l.line}</span><span className="truncate">{(lines[l.line - 1] || "").trim()}</span></div>
          <div className="lesson-body">
            {l.rungs.map((r) => <Lesson key={`r${r.index}`} item={r} live={liveRungs ? liveRungs[r.index] : undefined} />)}
            {l.sequences.map((s) => <Lesson key={`s${s.index}`} item={s} kind="sequence" />)}
            {l.alarms.map((a) => <Lesson key={`a${a.index}`} item={a} kind="alarm" />)}
            {l.blocks.map((b) => (
              <div key={`b${b.index}`} className="col" style={{ gap: 6 }}>
                <div className="block-head">Block <b className="mono">{b.block}</b> as <b className="mono">{b.as}</b> - {b.description}. Expanded into {b.rungs.length} rungs (they run after the program's own rungs):</div>
                {b.rungs.map((r) => <Lesson key={`br${r.index}`} item={r} live={liveRungs ? liveRungs[r.index] : undefined} />)}
                {b.sequences.map((s) => <Lesson key={`bs${s.index}`} item={s} kind="sequence" />)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OutlinePanel({ described, onGoLine }) {
  const state = usePlc((s) => s.state);
  if (!described) return <div className="empty">Nothing loaded yet.</div>;
  const v = (name) => (state ? (name.startsWith("R") && !name.includes(".") ? state.regs[name] : state.bits[name]) : undefined);
  return (
    <div className="outline col" style={{ gap: 14 }}>
      <section>
        <h3 className="small" style={{ marginBottom: 6 }}>Outputs this program controls ({described.controls.length} of 32)</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{described.controls.map((c) => <span key={c} className={cx("pill mono", v(c) === 1 && "on")}>{c}</span>)}{!described.controls.length && <span className="muted small">none - it only writes M bits and registers</span>}</div>
      </section>
      {described.aliases.length > 0 && (
        <section>
          <h3 className="small" style={{ marginBottom: 6 }}>Names</h3>
          <table className="grid"><thead><tr><th>Name</th><th>Address</th><th>Now</th></tr></thead><tbody>
            {described.aliases.map((a) => <tr key={a.alias}><td className="mono">{a.alias}</td><td className="mono">{a.target}</td><td className="mono">{v(a.target) ?? ""}</td></tr>)}
          </tbody></table>
        </section>
      )}
      <section>
        <h3 className="small" style={{ marginBottom: 6 }}>Who writes what (one owner per bit)</h3>
        <table className="grid"><thead><tr><th>Bit / register</th><th>Written by</th></tr></thead><tbody>
          {described.owners.map((o) => <tr key={o.bit + o.who}><td className="mono">{o.bit}</td><td className="ownerpill">{o.who}</td></tr>)}
        </tbody></table>
      </section>
      {described.sequences.length > 0 && (
        <section>
          <h3 className="small" style={{ marginBottom: 6 }}>Sequences</h3>
          {described.sequences.map((s) => (
            <div key={s.name} className="col" style={{ gap: 4, marginBottom: 8 }}>
              <div className="row"><b className="mono small">{s.name}</b><span className="muted xs">start: {s.start}</span>{s.abort && <span className="muted xs">stop: {s.abort}</span>}<button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => onGoLine(s.line)}>line {s.line}</button></div>
              <table className="grid"><tbody>{s.steps.map((st) => <tr key={st.index}><td className="mono">{st.index} {st.name}</td><td className="mono">{st.do.join(", ") || "-"}</td><td className="mono">until {st.next}{st.timeout ? ` (timeout ${st.timeout} → ${st.on_timeout})` : ""}</td></tr>)}</tbody></table>
            </div>
          ))}
        </section>
      )}
      {described.alarms.length > 0 && (
        <section>
          <h3 className="small" style={{ marginBottom: 6 }}>Alarms</h3>
          <table className="grid"><thead><tr><th>Bit</th><th>Text</th><th>Level</th></tr></thead><tbody>
            {described.alarms.map((a, i) => <tr key={i}><td className="mono">{a.bit}</td><td>{a.text}</td><td>{a.level}{a.toast ? "" : " (silent)"}</td></tr>)}
          </tbody></table>
        </section>
      )}
      <section>
        <h3 className="small" style={{ marginBottom: 6 }}>Safe state (emergency, stale inputs, no program)</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
          {described.safe.filter((s) => s.controlled).map((s) => <span key={s.name} className={cx("pill mono", s.exempt && "warn")}>{s.name} → {s.exempt ? "keeps running" : s.value}</span>)}
          {!described.safe.some((s) => s.controlled) && <span className="muted small">no physical outputs controlled</span>}
        </div>
      </section>
    </div>
  );
}
