// LadderSvg -- draws one EDITABLE rung (shared/engine/ladderedit.js network + coil) as SVG.
// Every element is clickable (onSelect(path) / onSelect("coil")); the selected one is outlined.
// With `read(name)` it shows live power flow: closed contacts pass power, green wires show how
// far the power reaches, the coil lights when its target is 1.
import { cx } from "../ui";
import { tokenizeExpr } from "nextplc-engine";

const CW = 92, CH = 62, CHAR = 6.6, RAIL = 12, GAP = 10;
const COILW = 160;
let seq = 0;
const k = () => `l${seq++}`;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const wire = (x, y, len, on) => <line key={k()} x1={x} y1={y} x2={x + len} y2={y} className={cx("lw", on && "pw")} />;

/** Evaluate a number expression text with live values (for CMP boxes). */
function numValue(text, read) {
  const toks = tokenizeExpr(String(text || ""));
  let src = "";
  for (const t of toks) {
    if (t.type === "End") break;
    if (t.type === "Ident") { const v = read(t.raw || t.text); src += ` ${typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0} `; }
    else if (t.type === "Number") src += ` ${t.text} `;
    else if (t.type === "Op" && "+-*/%".includes(t.text)) src += t.text === "/" ? " / " : ` ${t.text} `;
    else if (t.type === "LParen" || t.type === "RParen") src += t.type === "LParen" ? "(" : ")";
    else return NaN;
  }
  try { const v = Function(`"use strict";return (${src || 0});`)(); return Number.isFinite(v) ? Math.trunc(v) : NaN; } catch { return NaN; }
}
function nodeTrue(n, read) {
  if (!n) return true;
  switch (n.t) {
    case "const": return n.value;
    case "contact": { const v = Boolean(read(n.name)); return n.nc ? !v : v; }
    case "cmp": { const a = numValue(n.a, read), b = numValue(n.b, read); const v = { "==": a === b, "!=": a !== b, "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b }[n.op]; return n.nc ? !v : v; }
    case "timer": { const v = nodeTrue(n.inner, read); return n.nc ? !v : v; }
    case "group": { const v = nodeTrue(n.inner, read); return n.fn === "not" ? !v : v; }
    case "series": return n.items.every((x) => nodeTrue(x, read));
    case "parallel": return n.branches.some((x) => nodeTrue(x, read));
    default: return false;
  }
}

function layout(n, path, ctx) {
  const selected = ctx.sel !== "coil" && same(ctx.sel, path);
  const hit = (x, y, w, h) => <rect key={k()} x={x} y={y} width={w} height={h} className={cx("hit", selected && "sel")} onClick={(e) => { e.stopPropagation(); ctx.onSelect(path); }} />;
  if (!n) {
    return { w: CW, h: CH, draw: (x, y, p, els) => { els.push(wire(x, y, CW, p && ctx.live)); els.push(<g key={k()} className="slot" onClick={(e) => { e.stopPropagation(); ctx.onSelect([]); }}><rect x={x + 16} y={y - 14} width={CW - 32} height={28} rx={4} className={cx(same(ctx.sel, []) && "sel")} /><text x={x + CW / 2} y={y + 4} textAnchor="middle">+ contact</text></g>); return p; } };
  }
  switch (n.t) {
    case "series": {
      const parts = n.items.map((it, i) => layout(it, [...path, i], ctx));
      const w = parts.reduce((a, p) => a + p.w, 0), h = Math.max(...parts.map((p) => p.h));
      return { w, h, draw: (x, y, p, els) => { let px = x, pw = p; for (const part of parts) { pw = part.draw(px, y, pw, els); px += part.w; } return pw; } };
    }
    case "parallel": {
      const parts = n.branches.map((b, i) => layout(b, [...path, i], ctx));
      const inner = Math.max(...parts.map((p) => p.w));
      const w = inner + 2 * GAP, h = parts.reduce((a, p) => a + p.h, 0);
      return {
        w, h, draw: (x, y, p, els) => {
          let yy = y - h / 2, any = false; const ys = [];
          for (const part of parts) {
            const ym = yy + part.h / 2; ys.push(ym);
            els.push(wire(x, ym, GAP, p && ctx.live));
            const out = part.draw(x + GAP, ym, p, els);
            els.push(wire(x + GAP + part.w, ym, inner - part.w + GAP, out && ctx.live));
            any = any || out; yy += part.h;
          }
          els.push(<line key={k()} x1={x + GAP} y1={ys[0]} x2={x + GAP} y2={ys[ys.length - 1]} className={cx("lw", p && ctx.live && "pw")} />);
          els.push(<line key={k()} x1={x + GAP + inner} y1={ys[0]} x2={x + GAP + inner} y2={ys[ys.length - 1]} className={cx("lw", any && ctx.live && "pw")} />);
          if (selected) els.push(<rect key={k()} x={x + 2} y={y - h / 2 + 2} width={w - 4} height={h - 4} rx={4} className="selbox" />);
          return any;
        },
      };
    }
    case "contact":
    case "const": {
      const label = n.t === "const" ? (n.value ? "TRUE" : "FALSE") : n.name || "?";
      const W = Math.max(CW, Math.ceil(label.length * CHAR) + 18);
      return {
        w: W, h: CH, draw: (x, y, p, els) => {
          const cxm = x + W / 2;
          const closed = n.t === "const" ? n.value : nodeTrue(n, ctx.read);
          const out = p && closed;
          els.push(wire(x, y, W / 2 - 9, p && ctx.live));
          els.push(wire(cxm + 9, y, W / 2 - 9, out && ctx.live));
          const v = n.t === "contact" && n.name ? ctx.read(n.name) : undefined;
          els.push(<g key={k()} className={cx("contact", ctx.live && closed && "on", ctx.live && !closed && "open", !n.name && n.t === "contact" && "missing")}>
            <line x1={cxm - 9} y1={y - 11} x2={cxm - 9} y2={y + 11} />
            <line x1={cxm + 9} y1={y - 11} x2={cxm + 9} y2={y + 11} />
            {n.nc && <line x1={cxm - 11} y1={y + 11} x2={cxm + 11} y2={y - 11} />}
            {n.edge && <text x={cxm} y={y + 4} textAnchor="middle" className="edge">{n.edge === "rise" ? "P" : "N"}</text>}
            <text x={cxm} y={y - 17} textAnchor="middle" className="lbl">{label}</text>
            {ctx.live && v !== undefined && <text x={cxm} y={y + 25} textAnchor="middle" className="val">{v ? 1 : 0}</text>}
          </g>);
          els.push(hit(x + 4, y - 30, W - 8, 60));
          return out;
        },
      };
    }
    case "cmp": {
      const text = `${n.a || "?"} ${{ "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" }[n.op]} ${n.b || "?"}`;
      const W = Math.max(120, Math.ceil(Math.min(text.length, 28) * CHAR) + 30);
      return {
        w: W, h: CH, draw: (x, y, p, els) => {
          const t = nodeTrue(n, ctx.read), out = p && t;
          els.push(wire(x, y, 10, p && ctx.live)); els.push(wire(x + W - 10, y, 10, out && ctx.live));
          els.push(<g key={k()} className={cx("box", ctx.live && t && "on", ctx.live && !t && "open")}>
            <rect x={x + 10} y={y - 18} width={W - 20} height={36} rx={3} />
            <text x={x + W / 2} y={y - 5} textAnchor="middle" className="boxlbl">{n.nc ? "NOT CMP" : "CMP"}</text>
            <text x={x + W / 2} y={y + 10} textAnchor="middle" className="boxtxt">{clip(text, 28)}</text>
            {ctx.live && <text x={x + W / 2} y={y + 29} textAnchor="middle" className="val">{numValue(n.a, ctx.read)} : {numValue(n.b, ctx.read)}</text>}
          </g>);
          els.push(hit(x + 8, y - 22, W - 16, 44));
          return out;
        },
      };
    }
    case "timer":
    case "group": {
      const inner = layout(n.inner, [...path, 0], ctx);
      const BW = n.t === "timer" ? 92 : 56;
      const w = inner.w + BW, h = Math.max(CH, inner.h);
      return {
        w, h, draw: (x, y, p, els) => {
          const pin = inner.draw(x, y, p, els);
          const t = nodeTrue(n, ctx.read), out = p && t;
          const bx = x + inner.w;
          els.push(wire(bx, y, 8, pin && ctx.live)); els.push(wire(bx + BW - 8, y, 8, out && ctx.live));
          const label = n.t === "timer" ? `${n.nc ? "NOT " : ""}${n.kind === "off_for" ? "OFF_FOR" : "ON_FOR"}` : n.fn === "not" ? "NOT" : n.fn === "rise" ? "P" : "N";
          els.push(<g key={k()} className={cx("box", ctx.live && t && "on", ctx.live && !t && "open")}>
            <rect x={bx + 8} y={y - 18} width={BW - 16} height={36} rx={3} />
            <text x={bx + BW / 2} y={y - 4} textAnchor="middle" className="boxlbl">{label}</text>
            {n.t === "timer" && <text x={bx + BW / 2} y={y + 10} textAnchor="middle" className="boxtxt">{clip(n.time || "?", 11)}</text>}
          </g>);
          els.push(hit(bx + 6, y - 22, BW - 12, 44));
          if (selected) els.push(<rect key={k()} x={x + 1} y={y - h / 2 + 2} width={w - 2} height={h - 4} rx={4} className="selbox" />);
          return out;
        },
      };
    }
    default: return { w: CW, h: CH, draw: (x, y, p) => p };
  }
}

function coilBox(coil) {
  const lines = [];
  let label = "", name = coil.target || "?", symbol = null;
  switch (coil.type) {
    case "out": case "set": case "reset": case "toggle":
      symbol = { out: "", set: "S", reset: "R", toggle: "T" }[coil.type];
      if (coil.timer) { label = coil.timer.toUpperCase(); lines.push(`PT ${coil.time || "?"}`); }
      break;
    case "count":
      label = coil.down && !coil.reset ? "CTUD" : coil.down ? "CTUD" : "CTU";
      if (coil.down) lines.push(`CD ${coil.down}`);
      if (coil.reset) lines.push(`R  ${coil.reset}`);
      if (coil.preset) lines.push(`PV ${coil.preset}`);
      if (coil.done) lines.push(`Q → ${coil.done}`);
      break;
    case "move": label = "MOVE"; lines.push(`IN ${coil.value || "?"}`); break;
    case "calc": label = "CALC"; lines.push(`= ${coil.value || "?"}`); break;
    case "emergency": label = "EMERGENCY"; name = "robot stop"; lines.push(coil.text || ""); break;
    default: break;
  }
  return { label, name, symbol, lines };
}

/** An SFC transition condition: left rail, the network, then the transition bar and its target. */
function TransitionSvg({ net, ctx, tail }) {
  const L = layout(net, [], ctx);
  const h = Math.max(L.h, CH) + 8, y = h / 2;
  const label = tail.label || "";
  const w = RAIL + 10 + L.w + 26 + Math.max(60, label.length * CHAR + 16);
  const els = [];
  els.push(<line key="rl" x1={RAIL} y1={4} x2={RAIL} y2={h - 4} className="rail" />);
  els.push(wire(RAIL, y, 10, ctx.live));
  const powered = L.draw(RAIL + 10, y, true, els);
  const x = RAIL + 10 + L.w;
  const on = ctx.live && powered;
  els.push(wire(x, y, 16, on));
  els.push(<g key="tr" className={cx("trans", on && "on", tail.armed && "armed")}><rect x={x + 16} y={y - 14} width={6} height={28} rx={1} /><text x={x + 30} y={y + 4} className="lbl">{label}</text></g>);
  return <svg className="ladder-svg editable" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{els}</svg>;
}

export default function LadderSvg({ net, coil, sel, onSelect, read, live, rungLive, tail }) {
  seq = 0;
  const ctx = { sel, onSelect, read: read || (() => 0), live: Boolean(live && read) };
  if (!coil) return <TransitionSvg net={net} ctx={ctx} tail={tail || {}} />;
  const L = layout(net, [], ctx);
  const cb = coilBox(coil);
  const hasBox = Boolean(cb.label);
  const boxH = hasBox ? 30 + 15 * cb.lines.length : 0;
  const h = Math.max(L.h, CH, boxH + 22) + 8;
  const w = RAIL + 10 + L.w + 10 + COILW + (hasBox && cb.symbol !== null ? 70 : 0) + RAIL;
  const y = h / 2;
  const els = [];
  els.push(<line key="rl" x1={RAIL} y1={4} x2={RAIL} y2={h - 4} className="rail" />);
  els.push(<line key="rr" x1={w - RAIL} y1={4} x2={w - RAIL} y2={h - 4} className="rail" />);
  els.push(wire(RAIL, y, 10, ctx.live));
  const powered = L.draw(RAIL + 10, y, true, els);
  let x = RAIL + 10 + L.w;
  const pw = ctx.live && (rungLive !== undefined ? rungLive : powered);
  const coilSel = sel === "coil";
  const targetOn = ctx.live && coil.target ? Boolean(ctx.read(coil.target)) : false;
  els.push(wire(x, y, 10, ctx.live && powered));
  x += 10;
  const right = w - RAIL;
  if (hasBox) {
    const bw = cb.symbol !== null ? 96 : right - x - 10;
    els.push(<g key="fb" className={cx("fbox", coil.type === "emergency" && "emerg", pw && "driven")}>
      <rect x={x} y={y - boxH / 2} width={bw} height={boxH} rx={3} />
      <text x={x + bw / 2} y={y - boxH / 2 + 14} textAnchor="middle" className="boxlbl">{cb.label}</text>
      {cb.symbol === null && <text x={x + 8} y={y - boxH / 2 + 29} className="boxtxt">{clip(`${cb.name}${ctx.live && coil.target && /^r\d+$/i.test(coil.target) ? "" : ""}`, 24)}{ctx.live && coil.target ? ` = ${ctx.read(coil.target)}` : ""}</text>}
      {cb.lines.map((l, i) => <text key={i} x={x + 8} y={y - boxH / 2 + (cb.symbol === null ? 44 : 29) + 15 * i} className="boxtxt small">{clip(l, cb.symbol === null ? 24 : 13)}</text>)}
    </g>);
    els.push(<rect key="fbhit" x={x - 2} y={y - boxH / 2 - 2} width={bw + 4} height={boxH + 4} className={cx("hit", coilSel && "sel")} onClick={(e) => { e.stopPropagation(); onSelect("coil"); }} />);
    x += bw;
    if (cb.symbol === null) { els.push(wire(x, y, right - x, false)); return wrap(); }
    els.push(wire(x, y, 10, pw));
    x += 10;
  }
  // coil symbol
  const cxm = x + (right - x) / 2;
  els.push(wire(x, y, cxm - 12 - x, pw));
  els.push(wire(cxm + 12, y, right - cxm - 12, targetOn));
  els.push(<g key="coil" className={cx("coil", targetOn && "on", pw && "driven", !coil.target && "missing")}>
    <path d={`M ${cxm - 7} ${y - 12} Q ${cxm - 15} ${y} ${cxm - 7} ${y + 12}`} />
    <path d={`M ${cxm + 7} ${y - 12} Q ${cxm + 15} ${y} ${cxm + 7} ${y + 12}`} />
    {cb.symbol && <text x={cxm} y={y + 4} textAnchor="middle" className="edge">{cb.symbol}</text>}
    <text x={cxm} y={y - 18} textAnchor="middle" className="lbl">{clip(coil.target || "?", 22)}</text>
    {ctx.live && coil.target && <text x={cxm} y={y + 26} textAnchor="middle" className="val">{targetOn ? 1 : 0}</text>}
  </g>);
  els.push(<rect key="coilhit" x={cxm - 50} y={y - 32} width={100} height={64} className={cx("hit", coilSel && "sel")} onClick={(e) => { e.stopPropagation(); onSelect("coil"); }} />);
  return wrap();

  function wrap() {
    return <svg className="ladder-svg editable" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{els}</svg>;
  }
}
