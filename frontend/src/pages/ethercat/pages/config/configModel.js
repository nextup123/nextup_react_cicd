import { normDtype, validateValue } from '../../lib/format';

/** Stable key for a register row, e.g. "2005h/08h" (matches drive_profiles.json). */
export const regKey = (r) => `${r.index}/${r.subindex}`.toLowerCase();

export const clean = (v) => String(v ?? '').trim();

/** Type check plus the optional min / max set in the parameter editor. */
export function validateReg(value, reg) {
  const err = validateValue(value, reg.dataType);
  if (err || normDtype(reg.dataType) === 'string') return err;
  const n = Number(clean(value));
  if (reg.min !== undefined && n < reg.min) return `Below min (${reg.min})`;
  if (reg.max !== undefined && n > reg.max) return `Above max (${reg.max})`;
  return null;
}

/** Group label: the parameter's own group, else its index. */
export const groupOf = (r) => r.group || r.index;

/** Compare a staged value with a value read from the drive (numbers compared numerically). */
export function sameValue(a, b, dtype) {
  const x = clean(a);
  const y = clean(b);
  if (normDtype(dtype) !== 'string' && x !== '' && y !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    return Number(x) === Number(y);
  }
  return x === y;
}

/** Value staged for a drive: its override, else the template value. */
export function stagedValue(profiles, pos, reg) {
  const o = profiles[pos]?.[regKey(reg)];
  return o !== undefined ? o : reg.defaultValue;
}

export function isOverride(profiles, pos, reg) {
  return profiles[pos]?.[regKey(reg)] !== undefined;
}

/**
 * Work list for one drive.
 * mode "changes": registers whose staged value differs from the drive (or the drive wasn't read).
 * mode "all": every active register.
 */
export function planForDrive({ pos, regs, active, profiles, live, mode }) {
  const out = [];
  for (const r of regs) {
    const k = regKey(r);
    if (!active.has(k)) continue;
    const to = clean(stagedValue(profiles, pos, r));
    const l = live[pos]?.[k];
    const known = l?.state === 'ok';
    if (mode === 'changes' && known && sameValue(l.value, to, r.dataType)) continue;
    out.push({ reg: r, key: k, to, from: known ? String(l.value) : null, error: validateReg(to, r) });
  }
  return out;
}

/** Remove overrides equal to the template so the profile file stays minimal. */
export function compactProfiles(profiles, regs) {
  const byKey = new Map(regs.map((r) => [regKey(r), r]));
  const out = {};
  for (const [pos, values] of Object.entries(profiles)) {
    const kept = {};
    for (const [k, v] of Object.entries(values || {})) {
      const r = byKey.get(k);
      if (r && !sameValue(v, r.defaultValue, r.dataType)) kept[k] = clean(v);
    }
    if (Object.keys(kept).length) out[pos] = kept;
  }
  return out;
}

/**
 * Parameters added before the catalog existed (or typed by hand) get the
 * manual's named values and H-code when their register is in the catalog.
 * Display only: nothing is saved until the parameter list is saved.
 */
export function withCatalog(rows, catalog) {
  if (!catalog?.length) return rows;
  const byKey = new Map(catalog.map((c) => [regKey(c), c]));
  return rows.map((r) => {
    const c = byKey.get(regKey(r));
    if (!c || (r.options && r.param && r.group)) return r;
    return { ...r, param: r.param || c.param, group: r.group || c.group, ...(r.options || !c.options ? {} : { options: c.options }) };
  });
}
