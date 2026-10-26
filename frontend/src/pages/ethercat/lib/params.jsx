import { useEffect, useState } from 'react';
import { api, cached } from '../api';
import { normDtype, parseRegHex } from './format';

/**
 * "Easy codes": the H-codes shown on the drive's panel and in the SV660N
 * manual (H0D.00, H03.02 …). Group Hxx lives at index 0x2000 + xx and
 * parameter .yy at sub-index yy + 1, so H0D.00 = 200D:01 and H03.02 = 2003:03.
 * (Checked against all 426 H-parameters in the Commissioning Guide.)
 */
const num = (v) => (typeof v === 'number' ? v : parseRegHex(v));

export function easyCode(index, subindex) {
  const i = num(index);
  const s = num(subindex);
  if (!(i >= 0x2000 && i <= 0x20ff) || !(s >= 1 && s <= 0xff)) return null;
  return `H${(i - 0x2000).toString(16).toUpperCase().padStart(2, '0')}.${String(s - 1).padStart(2, '0')}`;
}

/** "H0D.00", "h0d.0", "H3.2", "H01.5", "H03-02" → { index, subindex } (numbers), else null. */
export function parseEasyCode(text) {
  const m = String(text ?? '').trim().match(/^h\s*([0-9a-f]{1,2})\s*[.\-\s]\s*(\d{1,3})$/i);
  if (!m) return null;
  const grp = parseInt(m[1], 16);
  const n = Number(m[2]);
  if (n > 254) return null;
  return { index: 0x2000 + grp, subindex: n + 1 };
}

/** "200D:01" (no 0x, uppercase). */
export function addrText(index, subindex) {
  const i = num(index);
  const s = num(subindex);
  if (Number.isNaN(i) || Number.isNaN(s)) return `${index}:${subindex}`;
  return `${i.toString(16).toUpperCase().padStart(4, '0')}:${s.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** "H0D.00 · 200D:01", or just "6041:00" for objects without an H-code. */
export function addrLabel(index, subindex) {
  const e = easyCode(index, subindex);
  return e ? `${e} · ${addrText(index, subindex)}` : addrText(index, subindex);
}

/** Does a search query match this parameter? Name, H-code (any spelling) or address. */
export function matchParam(p, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const easy = (p.easy || '').toLowerCase();
  if (p.name?.toLowerCase().includes(q) || p.group?.toLowerCase().includes(q)) return true;
  // H-code typed in any form: exact parameter, or a whole group ("h03", "h3").
  const code = parseEasyCode(q);
  if (code && num(p.index) === code.index && num(p.subindex) === code.subindex) return true;
  const grp = q.match(/^h\s*([0-9a-f]{1,2})\.?$/i);
  if (grp && num(p.index) === 0x2000 + parseInt(grp[1], 16)) return true;
  if (easy && easy.startsWith(q)) return true;
  // Address: "200d", "200d:01", "0x200d", "200d01", "200dh".
  const a = addrText(p.index, p.subindex).toLowerCase();
  const qa = q.replace(/^0x/, '').replace(/h/g, '').replace(/\s/g, '');
  return a.replace(':', '').startsWith(qa.replace(':', '')) || a.startsWith(qa);
}

/**
 * Every parameter the app knows: the SV660N catalog (with H-codes, units,
 * limits) plus the older SDO preset list (CiA402 and communication objects).
 * One entry per address; the catalog wins where both have it.
 */
export function useParamList() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    cached('paramList', async () => {
      const [presets, cat] = await Promise.all([api.presets().catch(() => []), api.parameterCatalog().catch(() => null)]);
      const byKey = new Map();
      for (const c of cat?.parameters || []) {
        byKey.set(addrText(c.index, c.subindex), { ...c, data_type: c.dataType, easy: easyCode(c.index, c.subindex) });
      }
      for (const p of Array.isArray(presets) ? presets : []) {
        const k = addrText(p.index, p.subindex);
        if (!byKey.has(k)) byKey.set(k, { ...p, dataType: normDtype(p.data_type ?? p.dataType), easy: easyCode(p.index, p.subindex) });
      }
      return [...byKey.values()].sort((a, b) => num(a.index) - num(b.index) || num(a.subindex) - num(b.subindex));
    }).then((l) => { if (alive) setList(l); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}

/** One row in a parameter dropdown: H-code, name, address. */
export function ParamOption({ p }) {
  return (
    <span className="param-opt">
      <span className="param-opt-code mono">{p.easy || ''}</span>
      <span className="param-opt-name">{p.name}{p.readOnly ? <span className="muted"> · read-only</span> : null}</span>
      <span className="param-opt-addr mono">{addrText(p.index, p.subindex)}</span>
    </span>
  );
}
