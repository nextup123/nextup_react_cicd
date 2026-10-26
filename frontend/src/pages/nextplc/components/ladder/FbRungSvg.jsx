// FbRungSvg -- function block instances and alarms drawn as ladder rungs.
//
// BlockRungSvg: left rail -> one contact per bit input (the address it is wired to) -> pin of the
// function-block box; parameters (time / number / register) enter the box as value tags; each bit
// output leaves the box on the right into a coil on its address -> right rail.
// AlarmRungSvg: left rail -> contact on the alarm bit -> ALARM box (level, text, toast) -> right rail.
// With `read(name)` both show live power flow like LadderSvg (closed contacts, lit coils).
import { cx } from "../ui";

const RAIL = 12, ROW = 46, CHAR = 6.6, PIN = 12;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const isOpen = (v) => !v || v === "(open)";

/** Ports of a block instance in drawing order: [{name, kind, value}] split into left / right. */
export function blockPorts(row, def) {
  const vals = row.with || {};
  const ports = def?.ports?.length
    ? def.ports.map((p) => ({ name: p.name, kind: p.kind, value: String(vals[p.name] ?? ""), def: p.default, optional: p.optional }))
    : Object.entries(vals).map(([name, v]) => ({ name, kind: "param", value: String(v) }));
  const left = ports.filter((p) => p.kind !== "out");
  const right = ports.filter((p) => p.kind === "out");
  return { left, right };
}

export function BlockRungSvg({ row, def, read, live, selected, onSelect }) {
  const { left, right } = blockPorts(row, def);
  const rd = read || (() => 0);
  const lv = Boolean(live && read);
  const shown = (p) => (p.value ? p.value : p.def ? `${p.def} (default)` : p.optional ? "(open)" : "?");
  const leftW = Math.max(110, ...left.map((p) => Math.ceil(Math.min(shown(p).length, 22) * CHAR) + 34));
  const rightW = Math.max(110, ...right.map((p) => Math.ceil(Math.min(shown(p).length, 22) * CHAR) + 34));
  const title = row.as || row.use || "block";
  const pinW = Math.max(...[...left, ...right].map((p) => p.name.length), 4) * CHAR;
  const boxW = Math.max(150, Math.ceil(Math.max(title.length, (row.use || "").length) * 7.2) + 24, Math.ceil(pinW * (right.length ? 2 : 1)) + 36);
  const rows = Math.max(left.length, right.length, 1);
  const boxH = 30 + rows * ROW - 12;
  const h = boxH + 22;
  const w = RAIL + leftW + boxW + rightW + RAIL;
  const bx = RAIL + leftW, by = 12;
  const pinY = (i) => by + 30 + i * ROW + ROW / 2 - 12;
  const els = [];
  els.push(<line key="rl" x1={RAIL} y1={4} x2={RAIL} y2={h - 4} className="rail" />);
  if (right.length) els.push(<line key="rr" x1={w - RAIL} y1={4} x2={w - RAIL} y2={h - 4} className="rail" />);
  els.push(<g key="box" className={cx("fbox", "fb-inst", lv && right.some((p) => !isOpen(p.value) && Boolean(rd(p.value))) && "driven")}>
    <rect x={bx} y={by} width={boxW} height={boxH} rx={4} />
    <line x1={bx} y1={by + 24} x2={bx + boxW} y2={by + 24} className="fbsep" />
    <text x={bx + boxW / 2} y={by + 16} textAnchor="middle" className="boxlbl">{clip(title, 22)}</text>
    {row.as && row.use && row.as !== row.use && <text x={bx + boxW - 6} y={by + boxH - 6} textAnchor="end" className="boxtxt small">{clip(row.use, 20)}</text>}
    {(!row.as || row.as === row.use) && <text x={bx + boxW - 6} y={by + boxH - 6} textAnchor="end" className="boxtxt small">FB</text>}
  </g>);
  left.forEach((p, i) => {
    const y = pinY(i);
    const v = shown(p);
    if (p.kind === "in") {
      const open = isOpen(p.value) && !p.def;
      const on = lv && !open && Boolean(rd(p.value || p.def));
      const cxm = RAIL + 16 + (leftW - 30) / 2;
      els.push(<line key={`w${i}a`} x1={RAIL} y1={y} x2={cxm - 9} y2={y} className={cx("lw", lv && "pw")} />);
      els.push(<line key={`w${i}b`} x1={cxm + 9} y1={y} x2={bx} y2={y} className={cx("lw", on && "pw")} />);
      els.push(<g key={`c${i}`} className={cx("contact", lv && on && "on", lv && !on && "open", !p.value && !p.def && !p.optional && "missing")}>
        <line x1={cxm - 9} y1={y - 11} x2={cxm - 9} y2={y + 11} />
        <line x1={cxm + 9} y1={y - 11} x2={cxm + 9} y2={y + 11} />
        <text x={cxm} y={y - 15} textAnchor="middle" className="lbl">{clip(v, 22)}</text>
        {lv && !open && <text x={cxm} y={y + 23} textAnchor="middle" className="val">{on ? 1 : 0}</text>}
      </g>);
    } else {
      // a parameter: value tag wired into the pin
      const tw = Math.min(leftW - 28, Math.ceil(Math.min(v.length, 22) * CHAR) + 14);
      const tx = bx - 16 - tw;
      els.push(<line key={`w${i}`} x1={tx + tw} y1={y} x2={bx} y2={y} className="lw" />);
      els.push(<g key={`t${i}`} className={cx("ptag", !p.value && !p.def && !p.optional && "missing")}>
        <rect x={tx} y={y - 10} width={tw} height={20} rx={10} />
        <text x={tx + tw / 2} y={y + 4} textAnchor="middle">{clip(v, 22)}</text>
        {lv && /^r\d+$/i.test(p.value) && <text x={tx + tw / 2} y={y + 22} textAnchor="middle" className="val">= {String(rd(p.value))}</text>}
      </g>);
    }
    els.push(<text key={`pl${i}`} x={bx + 8} y={y + 4} className="pinlbl">{p.name}</text>);
    els.push(<line key={`pt${i}`} x1={bx - PIN / 2} y1={y} x2={bx} y2={y} className="pin" />);
  });
  right.forEach((p, i) => {
    const y = pinY(i);
    const v = shown(p);
    const open = isOpen(p.value);
    const on = lv && !open && Boolean(rd(p.value));
    const x0 = bx + boxW;
    const cxm = x0 + 16 + (rightW - 30) / 2;
    els.push(<text key={`pr${i}`} x={x0 - 8} y={y + 4} textAnchor="end" className="pinlbl">{p.name}</text>);
    els.push(<line key={`r${i}a`} x1={x0} y1={y} x2={cxm - 12} y2={y} className={cx("lw", on && "pw")} />);
    els.push(<line key={`r${i}b`} x1={cxm + 12} y1={y} x2={w - RAIL} y2={y} className={cx("lw", on && "pw")} />);
    els.push(<g key={`q${i}`} className={cx("coil", on && "on", on && "driven", !p.value && !p.optional && "missing")}>
      <path d={`M ${cxm - 7} ${y - 12} Q ${cxm - 15} ${y} ${cxm - 7} ${y + 12}`} />
      <path d={`M ${cxm + 7} ${y - 12} Q ${cxm + 15} ${y} ${cxm + 7} ${y + 12}`} />
      <text x={cxm} y={y - 16} textAnchor="middle" className="lbl">{clip(v, 22)}</text>
      {lv && !open && <text x={cxm} y={y + 24} textAnchor="middle" className="val">{on ? 1 : 0}</text>}
    </g>);
  });
  els.push(<rect key="hit" x={2} y={2} width={w - 4} height={h - 4} className={cx("hit", selected && "sel")} onClick={(e) => { e.stopPropagation(); onSelect?.(); }} />);
  return <svg className="ladder-svg editable" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{els}</svg>;
}

export const ALARM_LEVELS = ["info", "warning", "error"];

export function AlarmRungSvg({ alarm, read, live, selected, onSelect }) {
  const rd = read || (() => 0);
  const lv = Boolean(live && read);
  const bit = String(alarm.bit || "");
  const text = String(alarm.text || "");
  const level = ALARM_LEVELS.includes(String(alarm.level || "error").toLowerCase()) ? String(alarm.level || "error").toLowerCase() : "error";
  const toast = String(alarm.toast ?? "true") !== "false";
  const on = lv && bit && Boolean(rd(bit));
  const cW = Math.max(96, Math.ceil(Math.min(bit.length || 1, 22) * CHAR) + 24);
  const boxW = Math.max(200, Math.ceil(Math.min(text.length, 40) * 6.4) + 28);
  const h = 70, y = h / 2;
  const w = RAIL + 10 + cW + 24 + boxW + 24 + RAIL;
  const cxm = RAIL + 10 + cW / 2;
  const bx = RAIL + 10 + cW + 24;
  const els = [];
  els.push(<line key="rl" x1={RAIL} y1={4} x2={RAIL} y2={h - 4} className="rail" />);
  els.push(<line key="rr" x1={w - RAIL} y1={4} x2={w - RAIL} y2={h - 4} className="rail" />);
  els.push(<line key="w1" x1={RAIL} y1={y} x2={cxm - 9} y2={y} className={cx("lw", lv && "pw")} />);
  els.push(<line key="w2" x1={cxm + 9} y1={y} x2={bx} y2={y} className={cx("lw", on && "pw")} />);
  els.push(<line key="w3" x1={bx + boxW} y1={y} x2={w - RAIL} y2={y} className={cx("lw", on && "pw")} />);
  els.push(<g key="c" className={cx("contact", lv && on && "on", lv && !on && "open", !bit && "missing")}>
    <line x1={cxm - 9} y1={y - 11} x2={cxm - 9} y2={y + 11} />
    <line x1={cxm + 9} y1={y - 11} x2={cxm + 9} y2={y + 11} />
    <text x={cxm} y={y - 16} textAnchor="middle" className="lbl">{clip(bit || "?", 22)}</text>
    {lv && bit && <text x={cxm} y={y + 25} textAnchor="middle" className="val">{on ? 1 : 0}</text>}
  </g>);
  els.push(<g key="box" className={cx("fbox", "alarm", `lvl-${level}`, on && "active")}>
    <rect x={bx} y={y - 24} width={boxW} height={48} rx={4} />
    <text x={bx + 8} y={y - 8} className="boxlbl">ALARM · {level.toUpperCase()}{toast ? " · toast" : ""}</text>
    <text x={bx + 8} y={y + 10} className="boxtxt">{clip(text || "(text = the bit's name)", 40)}</text>
  </g>);
  els.push(<rect key="hit" x={2} y={2} width={w - 4} height={h - 4} className={cx("hit", selected && "sel")} onClick={(e) => { e.stopPropagation(); onSelect?.(); }} />);
  return <svg className="ladder-svg editable" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{els}</svg>;
}
