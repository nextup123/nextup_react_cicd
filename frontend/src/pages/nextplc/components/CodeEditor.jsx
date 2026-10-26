// CodeEditor -- a textarea over a highlighted copy of the text (YAML). Reports the
// cursor line so the Teacher and the Ladder can follow it; marks the error line and the rungs that
// are TRUE right now (gutter bar) when the program is the one running in the PLC.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAddress } from "nextplc-engine";
import { cx } from "./ui";

const KW = new Set(["IF", "WHEN", "THEN", "ALWAYS", "AND", "OR", "NOT", "NAME", "SETTING", "RETAIN", "SAFE", "EXEMPT", "ALARM", "SEQUENCE", "END", "USE", "AS", "WITH", "PROGRAM", "SCAN", "START", "STOP", "ABORT", "IDLE", "STEP", "WAIT", "UNTIL", "TIMEOUT", "REPEAT", "TIMES", "IS", "ON", "OFF", "RISES", "FALLS", "TURNS", "FOR", "RUNNING", "STOPPED", "AT", "TRUE", "FALSE", "DEFAULT", "KEEP", "INFO", "WARNING", "ERROR", "SILENT", "TO", "DONE", "NOTHING"]);
const ACT = new Set(["SET", "RESET", "TOGGLE", "PULSE", "BLINK", "COUNT", "DOWN", "UP", "CLEAR", "EMERGENCY", "AFTER", "STAYS", "HOLD"]);

/** One line -> React spans. Cheap tokenizer on purpose (runs on every keystroke). */
function highlightLine(line, yaml) {
  const out = [];
  let i = 0, key = 0;
  const push = (cls, text) => out.push(cls ? <span key={key++} className={cls}>{text}</span> : <span key={key++}>{text}</span>);
  while (i < line.length) {
    const c = line[i];
    if (c === "#") { push("cmt", line.slice(i)); break; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j++;
      push("str", line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < line.length && /[0-9.]/.test(line[j])) j++;
      let k = j;
      while (k < line.length && /[A-Za-z]/.test(line[k])) k++;
      push(k > j ? "time" : "num", line.slice(i, k));
      i = k;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_.]/.test(line[j])) j++;
      const w = line.slice(i, j);
      const up = w.toUpperCase();
      const a = parseAddress(w);
      if (a.ok) push(`addr ${a.addr.area.toLowerCase()}`, w);
      else if (yaml && line[j] === ":" ) push("kw", w);
      else if (KW.has(up)) push("kw", w);
      else if (ACT.has(up)) push("act", w);
      else push("ident", w);
      i = j;
      continue;
    }
    push(null, c);
    i++;
  }
  return out;
}

export default function CodeEditor({ value, onChange, readOnly, errorLine, liveLines, onCursorLine, cursorLine, placeholder, tut }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const gutRef = useRef(null);
  const [cur, setCur] = useState(1);
  const lines = useMemo(() => value.split("\n"), [value]);
  const yaml = useMemo(() => !/^\s*(IF|WHEN|NAME|SETTING|PROGRAM|SEQUENCE|USE|ALWAYS|SAFE|ALARM|RETAIN|SCAN)\b/im.test(value), [value]);

  const updateCursor = () => {
    const ta = taRef.current;
    if (!ta) return;
    const l = value.slice(0, ta.selectionStart).split("\n").length;
    if (l !== cur) { setCur(l); onCursorLine?.(l); }
  };
  useEffect(() => { if (cursorLine && cursorLine !== cur) { setCur(cursorLine); scrollToLine(cursorLine); } }, [cursorLine]); // eslint-disable-line

  const scrollToLine = (l) => {
    const ta = taRef.current;
    if (!ta) return;
    const y = (l - 1) * 20;
    if (y < ta.scrollTop + 20 || y > ta.scrollTop + ta.clientHeight - 40) ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
  };
  const onScroll = (e) => {
    if (preRef.current) { preRef.current.style.transform = `translate(${-e.target.scrollLeft}px, ${-e.target.scrollTop}px)`; }
    if (gutRef.current) gutRef.current.scrollTop = e.target.scrollTop;
  };
  const onKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      const s = ta.selectionStart, end = ta.selectionEnd;
      const next = value.slice(0, s) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };

  return (
    <div className={cx("editor", readOnly && "readonly")} data-tut={tut}>
      <div className="gutter" ref={gutRef}>
        {lines.map((_, i) => <div key={i} className={cx(i + 1 === cur && "cur", i + 1 === errorLine && "err", liveLines?.has(i + 1) && "live")}>{i + 1}</div>)}
      </div>
      <div className="body">
        <pre className="hl" ref={preRef} aria-hidden={!readOnly}>
          {lines.map((l, i) => <span key={i} className={cx("ln", i + 1 === cur && !readOnly && "cur", i + 1 === errorLine && "err")}>{highlightLine(l, yaml)}{"\n"}</span>)}
        </pre>
        {!readOnly && (
          <textarea
            ref={taRef}
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder={placeholder}
            onChange={(e) => { onChange(e.target.value); }}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onKeyDown={onKeyDown}
            onSelect={updateCursor}
            onScroll={onScroll}
          />
        )}
      </div>
    </div>
  );
}
