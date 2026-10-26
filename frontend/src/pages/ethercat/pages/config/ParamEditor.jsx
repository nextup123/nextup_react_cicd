import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { toast } from '../../components/Toasts';
import { confirmDialog, Modal, SearchSelect } from '../../components/ui';
import { DATA_TYPES, hex, normDtype, plural, regLabel, validateValue } from '../../lib/format';
import { regKey } from './configModel';
import { addrLabel, easyCode, matchParam } from '../../lib/params';

const EMPTY = { name: '', group: '', index: '', subindex: '', dataType: 'int16', defaultValue: '0', units: '', min: '', max: '', description: '', param: '', options: [] };

/** Catalog entry (parameter_catalog.json) → editor form, so one pick fills every field. */
const fromCatalog = (c) => toForm({
  name: c.name, param: c.param, index: c.index, subindex: c.subindex, dataType: c.dataType,
  defaultValue: c.defaultValue, min: c.min, max: c.max, units: c.units, group: c.group,
  description: c.description, options: c.options,
});

const catFilter = (c, q) => matchParam({ ...c, easy: c.param || easyCode(c.index, c.subindex) }, q);
const catRender = (c) => (
  <div className="cat-opt">
    <span className="cat-id mono">{c.param}</span>
    <span className="cat-name">{c.name}</span>
    <span className="cat-reg mono muted">{c.index.slice(0, 4)}:{c.subindex.slice(0, 2)}</span>
  </div>
);

/** "2005h", "0x2005" or "2005" (register tables are hex) → number, NaN when invalid. */
function parseHexField(v) {
  const s = String(v ?? '').trim().replace(/^0x/i, '').replace(/h$/i, '');
  return /^[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : NaN;
}

const toForm = (r) => ({
  ...EMPTY,
  ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'options').map(([k, v]) => [k, v === undefined || v === null ? '' : String(v)])),
  options: r.options || [],
  index: regLabel(r.index).replace(/^0x/, ''),
  subindex: regLabel(r.subindex, 2).replace(/^0x/, ''),
  dataType: normDtype(r.dataType),
});

/** Form → stored register (driver_config.json shape) plus a map of field errors. */
function fromForm(f, others) {
  const errors = {};
  const index = parseHexField(f.index);
  const subindex = parseHexField(f.subindex);
  if (!f.name.trim()) errors.name = 'Required';
  if (!(index >= 0 && index <= 0xffff)) errors.index = 'Hex, 0000…FFFF';
  if (!(subindex >= 0 && subindex <= 0xff)) errors.subindex = 'Hex, 00…FF';
  const isString = f.dataType === 'string';
  const num = (v) => (String(v).trim() === '' ? undefined : Number(v));
  const min = isString ? undefined : num(f.min);
  const max = isString ? undefined : num(f.max);
  if (min !== undefined && Number.isNaN(min)) errors.min = 'Not a number';
  if (max !== undefined && Number.isNaN(max)) errors.max = 'Not a number';
  if (min !== undefined && max !== undefined && min > max) errors.max = 'Below min';
  const dErr = validateValue(f.defaultValue, f.dataType);
  if (dErr) errors.defaultValue = dErr;
  else if (!isString) {
    const d = Number(f.defaultValue);
    if (min !== undefined && d < min) errors.defaultValue = `Below min (${min})`;
    if (max !== undefined && d > max) errors.defaultValue = `Above max (${max})`;
  }
  const reg = {
    name: f.name.trim(),
    index: Number.isNaN(index) ? f.index : `${hex(index, 4).slice(2)}h`,
    subindex: Number.isNaN(subindex) ? f.subindex : `${hex(subindex, 2).slice(2)}h`,
    dataType: f.dataType,
    defaultValue: isString ? String(f.defaultValue) : Number(f.defaultValue),
  };
  if (!errors.index && !errors.subindex && others.some((o) => regKey(o) === regKey(reg))) {
    errors.subindex = `${regLabel(reg.index)}:${regLabel(reg.subindex, 2).slice(2)} is already in the list`;
  }
  if (min !== undefined) reg.min = min;
  if (max !== undefined) reg.max = max;
  for (const k of ['units', 'group', 'description', 'param']) if (f[k].trim()) reg[k] = f[k].trim();
  if (f.options?.length && !isString) reg.options = f.options;
  return { reg, errors };
}

/**
 * Add, edit, reorder and remove the parameters shown on the Driver config page.
 * Saved to data/driver_config.json (the same file v1 used), so new parameters
 * need no code change.
 */
export default function ParamEditor({ regs, onClose, onSaved }) {
  const [list, setList] = useState(regs);
  const [editing, setEditing] = useState(null); // null | { at: number | -1, form }
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const dirty = list !== regs;

  useEffect(() => {
    api.parameterCatalog()
      .then((c) => setCatalog((c.parameters || []).filter((p) => !p.readOnly)))
      .catch(() => setCatalog([]));
  }, []);
  const groups = useMemo(() => [...new Set(list.map((r) => r.group).filter(Boolean))], [list]);

  const others = editing ? list.filter((_, i) => i !== editing.at) : list;
  const check = editing ? fromForm(editing.form, others) : null;
  const set = (k) => (e) => setEditing((ed) => ({ ...ed, form: { ...ed.form, [k]: e.target.value } }));

  const commit = () => {
    if (Object.keys(check.errors).length) return;
    setList((l) => (editing.at === -1 ? [...l, check.reg] : l.map((r, i) => (i === editing.at ? check.reg : r))));
    setEditing(null);
  };
  const move = (i, d) => setList((l) => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    const n = [...l];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const remove = async (i) => {
    const r = list[i];
    const ok = await confirmDialog({
      title: `Remove "${r.name}"?`,
      message: 'It disappears from the configuration page. Values already on the drives are not touched, and any per-drive value saved for it is dropped.',
      confirmText: 'Remove', tone: 'danger',
    });
    if (ok) setList((l) => l.filter((_, j) => j !== i));
  };
  const close = async () => {
    if (dirty && !(await confirmDialog({ title: 'Discard parameter changes?', message: 'Your edits to the parameter list have not been saved.', confirmText: 'Discard', tone: 'danger' }))) return;
    onClose();
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveDriverConfig(list);
      toast(`Saved ${plural(r.registers.length, 'parameter')}`, 'success');
      onSaved(r.registers);
    } catch (err) {
      toast(`Not saved: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const err = (k) => check?.errors[k] && <span className="field-error">{check.errors[k]}</span>;

  return (
    <Modal open size="modal-lg" onClose={editing ? () => setEditing(null) : close} labelledBy="param-title">
      <div className="modal-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="param-title">{editing ? (editing.at === -1 ? 'New parameter' : `Edit "${list[editing.at].name}"`) : 'Parameters'}</h3>
          <div className="muted small">{editing ? 'Index and sub-index are hex, as in the drive manual.' : `${plural(list.length, 'parameter')} · saved to data/driver_config.json`}</div>
        </div>
        <button className="icon-btn" onClick={editing ? () => setEditing(null) : close} aria-label="Close"><X size={18} /></button>
      </div>

      {editing ? (
        <div className="modal-body">
          {catalog.length > 0 && (
            <div className="cat-pick">
              <span className="label"><BookOpen size={13} /> Pick from the SV660N manual <span className="muted">({catalog.length} settable parameters)</span></span>
              <SearchSelect items={catalog} filter={catFilter} render={catRender} limit={80}
                placeholder="Search by name, H-code or register, e.g. gain, H03.02, 2005:08"
                onPick={(c) => setEditing((ed) => ({ ...ed, form: fromCatalog(c) }))} />
              {editing.form.param && <div className="muted small">Filled from {editing.form.param}. You can still change any field.</div>}
            </div>
          )}
          <div className="form-grid">
            <label className="field span-2"><span className="label">Name</span>
              <input className="input" value={editing.form.name} onChange={set('name')} placeholder="e.g. Speed loop gain" autoFocus />{err('name')}</label>
            <label className="field"><span className="label">Index (hex)</span>
              <input className="input mono" value={editing.form.index} onChange={set('index')} placeholder="2008" />{err('index')}</label>
            <label className="field"><span className="label">Sub-index (hex)</span>
              <input className="input mono" value={editing.form.subindex} onChange={set('subindex')} placeholder="01" />{err('subindex')}</label>
            <label className="field"><span className="label">Data type</span>
              <select className="input" value={editing.form.dataType} onChange={set('dataType')}>
                {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label className="field"><span className="label">Default (template) value</span>
              <input className="input mono" value={editing.form.defaultValue} onChange={set('defaultValue')} />{err('defaultValue')}</label>
            {editing.form.dataType !== 'string' && (
              <>
                <label className="field"><span className="label">Min <span className="muted">(optional)</span></span>
                  <input className="input mono" value={editing.form.min} onChange={set('min')} />{err('min')}</label>
                <label className="field"><span className="label">Max <span className="muted">(optional)</span></span>
                  <input className="input mono" value={editing.form.max} onChange={set('max')} />{err('max')}</label>
              </>
            )}
            <label className="field"><span className="label">Units <span className="muted">(optional)</span></span>
              <input className="input" value={editing.form.units} onChange={set('units')} placeholder="ms, rpm, %…" /></label>
            <label className="field"><span className="label">Group <span className="muted">(optional)</span></span>
              <input className="input" value={editing.form.group} onChange={set('group')} list="param-groups" placeholder="Defaults to the index" />
              <datalist id="param-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></label>
            {editing.form.options?.length > 0 && (
              <div className="field span-2"><span className="label">Allowed values</span>
                <div className="opt-chips">{editing.form.options.map((o) => <span key={o.value} className="opt-chip"><b className="mono">{o.value}</b> {o.label}</span>)}</div>
                <span className="muted small">Shown as a list in the configuration grid.</span></div>
            )}
            <label className="field span-2"><span className="label">Description <span className="muted">(optional)</span></span>
              <textarea className="input" rows={2} value={editing.form.description} onChange={set('description')} placeholder="Shown as a tooltip on the configuration page" /></label>
          </div>
        </div>
      ) : (
        <div className="modal-body flush">
          <div className="param-list">
            {list.map((r, i) => (
              <div key={regKey(r)} className="param-row">
                <div className="param-main">
                  <div className="param-name">{r.name}{r.param && <span className="muted mono"> · {r.param}</span>}{r.units && <span className="muted"> · {r.units}</span>}</div>
                  <div className="param-meta mono">
                    {addrLabel(r.index, r.subindex)} · {normDtype(r.dataType)} · default {String(r.defaultValue)}
                    {(r.min !== undefined || r.max !== undefined) && ` · ${r.min ?? '…'} to ${r.max ?? '…'}`}
                    {r.group && ` · ${r.group}`}
                  </div>
                </div>
                <div className="param-actions">
                  <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={15} /></button>
                  <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move down"><ArrowDown size={15} /></button>
                  <button className="icon-btn" onClick={() => setEditing({ at: i, form: toForm(r) })} aria-label={`Edit ${r.name}`}><Pencil size={15} /></button>
                  <button className="icon-btn danger" onClick={() => remove(i)} aria-label={`Remove ${r.name}`}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            {list.length === 0 && <div className="empty muted">No parameters. Add one to get started.</div>}
          </div>
        </div>
      )}

      <div className="modal-foot">
        {editing ? (
          <>
            <button className="btn" onClick={() => setEditing(null)}>Back</button>
            <button className="btn btn-primary" onClick={commit} disabled={Object.keys(check.errors).length > 0}>{editing.at === -1 ? 'Add to list' : 'Update'}</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setEditing({ at: -1, form: { ...EMPTY } })} style={{ marginRight: 'auto' }}><Plus size={15} /> Add parameter</button>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>{saving ? <span className="spinner" /> : null} Save list</button>
          </>
        )}
      </div>
    </Modal>
  );
}
