import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Download, FileDown, FileUp, Filter, Grid3x3, List, MoreHorizontal, RotateCcw, Settings2, Square, Upload, XCircle,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { toast } from '../components/Toasts';
import { confirmDialog, Progress, SearchInput, Spinner } from '../components/ui';
import { jointLabel, normDtype, plural, regLabel, stateLabel, stateTone } from '../lib/format';
import { csvRow, downloadFile, stamp } from '../lib/history';
import { useMediaQuery } from '../lib/hooks';
import { clearIntent, peekIntent } from '../lib/store';
import ApplyModal from './config/ApplyModal';
import ParamEditor from './config/ParamEditor';
import { clean, compactProfiles, groupOf, isOverride, planForDrive, regKey, sameValue, stagedValue, validateReg, withCatalog } from './config/configModel';
import { addrLabel, addrText, easyCode, matchParam } from '../lib/params';

const FALLBACK_DRIVES = [0, 1, 2, 3, 4, 5];
const INCLUDED_KEY = 'nextup.ecat.configDrives';

// Page state survives navigating away and back (reads are slow on a real bus).
const memory = { live: {}, results: {} };

export default function DriverConfigPage() {
  const { slaves, masterId } = useApp();
  const narrow = useMediaQuery('(max-width: 760px)');

  const [regs, setRegs] = useState(null);
  const catalogRef = useRef([]);
  const [loadError, setLoadError] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [saveState, setSaveState] = useState('saved'); // saved | saving | error
  const [active, setActive] = useState(null); // Set of register keys
  const [live, setLiveState] = useState(memory.live); // pos -> key -> { state, value, msg }
  const [results, setResultsState] = useState(memory.results); // pos -> key -> { state, msg }
  const [mode, setMode] = useState('changes');
  const [query, setQuery] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  // Opened from the overview / network page for one drive → show that drive.
  const [intent] = useState(() => peekIntent('config'));
  const [viewPref, setViewPref] = useState(intent ? 'drive' : null); // matrix | drive (null = auto)
  const [focusPos, setFocusPos] = useState(intent?.pos ?? null);
  const [reading, setReading] = useState(null); // { done, total }
  const [applyPlan, setApplyPlan] = useState(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const cancelRead = useRef(false);
  const saveTimer = useRef(null);
  const importRef = useRef(null);

  const allDrives = useMemo(() => (slaves.length ? slaves.map((s) => s.position) : FALLBACK_DRIVES), [slaves]);
  const [includedRaw, setIncludedRaw] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(INCLUDED_KEY)); return Array.isArray(v) ? v : null; } catch { return null; }
  });
  const included = useMemo(() => {
    const set = includedRaw ? allDrives.filter((p) => includedRaw.includes(p)) : allDrives;
    return set.length ? set : allDrives;
  }, [includedRaw, allDrives]);
  const toggleIncluded = (pos) => {
    const next = included.includes(pos) ? included.filter((p) => p !== pos) : [...included, pos].sort((a, b) => a - b);
    if (!next.length) return;
    setIncludedRaw(next);
    try { localStorage.setItem(INCLUDED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const view = viewPref ?? (narrow ? 'drive' : 'matrix');
  const drivePos = included.includes(focusPos) ? focusPos : included[0];

  const setLive = useCallback((pos, key, v) => setLiveState((l) => {
    const next = { ...l, [pos]: { ...l[pos], [key]: v } };
    memory.live = next;
    return next;
  }), []);
  const setResult = useCallback((pos, key, v) => setResultsState((r) => {
    const next = { ...r, [pos]: { ...r[pos], [key]: v } };
    memory.results = next;
    return next;
  }), []);

  useEffect(() => { clearIntent('config'); }, []);

  useEffect(() => {
    Promise.all([api.driverConfig(), api.driveProfiles().catch(() => ({ drives: {} })), api.parameterCatalog().catch(() => null)])
      .then(([list, prof, cat]) => {
        catalogRef.current = cat?.parameters || [];
        const rows = withCatalog(Array.isArray(list) ? list : [], catalogRef.current);
        setRegs(rows);
        setActive(new Set(rows.map(regKey)));
        setProfiles(prof?.drives || {});
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  // Profiles save themselves shortly after the last edit.
  const persistProfiles = useCallback((next, rows) => {
    clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveDriveProfiles(compactProfiles(next, rows));
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
        toast(`Could not save drive values: ${err.message}`, 'error');
      }
    }, 600);
  }, []);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const updateProfiles = (fn) => setProfiles((p) => {
    const next = fn(structuredClone(p));
    persistProfiles(next, regs);
    return next;
  });

  const setCell = (pos, reg, value) => updateProfiles((p) => {
    (p[pos] ||= {})[regKey(reg)] = value;
    return p;
  });
  const clearCell = (pos, reg) => updateProfiles((p) => { if (p[pos]) delete p[pos][regKey(reg)]; return p; });
  const clearRow = (reg) => updateProfiles((p) => { Object.values(p).forEach((v) => delete v[regKey(reg)]); return p; });
  const clearDrive = (pos) => updateProfiles((p) => { delete p[pos]; return p; });
  const loadFromDrive = (pos) => {
    const l = live[pos];
    if (!l) { toast(`Read ${jointLabel(pos)} first`, 'warn'); return; }
    let n = 0;
    updateProfiles((p) => {
      for (const r of regs) {
        const v = l[regKey(r)];
        if (v?.state === 'ok') { (p[pos] ||= {})[regKey(r)] = clean(v.value); n++; }
      }
      return p;
    });
    toast(`${jointLabel(pos)}: ${plural(n, 'value')} copied from the drive`, 'success');
  };
  const copyDriveToAll = (pos) => updateProfiles((p) => {
    for (const other of included) {
      if (other === pos) continue;
      p[other] = { ...(p[pos] || {}) };
    }
    return p;
  });

  // Template edits go to driver_config.json (the default for every drive).
  const tplTimers = useRef({});
  const setTemplate = (reg, value) => {
    const k = regKey(reg);
    setRegs((rows) => rows.map((r) => (regKey(r) === k ? { ...r, defaultValue: value } : r)));
    clearTimeout(tplTimers.current[k]);
    if (validateReg(value, reg)) return;
    tplTimers.current[k] = setTimeout(() => {
      const v = typeof reg.defaultValue === 'number' && Number.isFinite(Number(value)) ? Number(value) : clean(value);
      api.saveDriverDefault(reg.index, reg.subindex, v).catch((err) => toast(`Value not saved: ${err.message}`, 'error'));
    }, 700);
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const g = new Map();
    for (const r of regs || []) {
      if (q && !`${r.name} ${r.group || ''} ${r.units || ''}`.toLowerCase().includes(q) && !matchParam({ ...r, easy: easyCode(r.index, r.subindex) }, q)) continue;
      if (onlyDiff) {
        const differs = included.some((pos) => {
          const l = live[pos]?.[regKey(r)];
          return isOverride(profiles, pos, r) || (l?.state === 'ok' && !sameValue(l.value, stagedValue(profiles, pos, r), r.dataType));
        });
        if (!differs) continue;
      }
      const key = groupOf(r);
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(r);
    }
    return [...g.entries()];
  }, [regs, query, onlyDiff, included, live, profiles]);

  const plan = useMemo(() => (regs && active ? included.map((pos) => ({
    pos, items: planForDrive({ pos, regs, active, profiles, live, mode }),
  })) : []), [regs, active, included, profiles, live, mode]);

  if (loadError) return <div className="page"><div className="callout callout-danger">Could not load driver_config.json: {loadError}</div></div>;
  if (!regs || !active) return <div className="empty"><Spinner large /></div>;

  const totalWrites = plan.reduce((n, d) => n + d.items.length, 0);
  const invalid = plan.flatMap((d) => d.items.filter((it) => it.error).map((it) => ({ ...it, pos: d.pos })));
  const unread = included.filter((pos) => !live[pos]);
  const busy = !!reading || !!applyPlan;

  const readDrives = async (positions) => {
    cancelRead.current = false;
    const list = regs.filter((r) => active.has(regKey(r)));
    const total = positions.length * list.length;
    let done = 0;
    let fails = 0;
    setReading({ done, total });
    for (const pos of positions) {
      for (const r of list) {
        if (cancelRead.current) break;
        const k = regKey(r);
        try {
          const res = await api.sdoGet({ master_id: masterId, slave_position: pos, sdo_index: r.index, sdo_subindex: r.subindex, sdo_data_type: normDtype(r.dataType) });
          if (!res?.success) throw new Error(res?.sdo_return_message || 'Read failed');
          setLive(pos, k, { state: 'ok', value: normDtype(r.dataType) === 'string' ? res.sdo_return_value_string : res.sdo_return_value, at: Date.now() });
        } catch (err) {
          fails++;
          setLive(pos, k, { state: 'error', msg: err.message });
        }
        setReading({ done: ++done, total });
      }
    }
    setReading(null);
    toast(cancelRead.current ? 'Read stopped' : fails ? `Read finished with ${plural(fails, 'error')}` : `Read ${plural(positions.length, 'drive')}`,
      fails ? 'warn' : 'success');
  };

  const openApply = async () => {
    if (invalid.length) { toast(`Fix ${plural(invalid.length, 'invalid value')} first`, 'error'); return; }
    if (!totalWrites) { toast(mode === 'changes' ? 'Every drive already matches its staged values' : 'Nothing selected to write', 'info'); return; }
    if (mode === 'changes' && unread.length) {
      const ok = await confirmDialog({
        title: 'Some drives have not been read',
        message: `${unread.map(jointLabel).join(', ')} ${unread.length === 1 ? 'has' : 'have'} not been read, so every selected setting will be written to ${unread.length === 1 ? 'it' : 'them'}. Read them first to write only what changed.`,
        confirmText: 'Continue anyway',
        cancelText: 'Go back',
        tone: 'warn',
      });
      if (!ok) return;
    }
    setApplyPlan(plan.filter((d) => d.items.length));
  };

  const exportCsv = () => {
    const rows = [csvRow(['Parameter', 'Register', 'Type', 'Template', ...included.flatMap((p) => [`${jointLabel(p)} staged`, `${jointLabel(p)} on drive`])])];
    for (const r of regs) {
      rows.push(csvRow([r.name, addrLabel(r.index, r.subindex), normDtype(r.dataType), r.defaultValue,
        ...included.flatMap((p) => { const l = live[p]?.[regKey(r)]; return [stagedValue(profiles, p, r), l?.state === 'ok' ? l.value : '']; })]));
    }
    downloadFile(`drive_config_${stamp()}.csv`, rows.join('\n'), 'text/csv');
  };
  const exportJson = () => {
    const data = { exportedAt: new Date().toISOString(), template: regs.map(({ name, index, subindex, dataType, defaultValue }) => ({ name, index, subindex, dataType, defaultValue })), drives: compactProfiles(profiles, regs) };
    downloadFile(`drive_profiles_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  const importJson = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const drives = data?.drives;
      if (!drives || typeof drives !== 'object') throw new Error('No "drives" section in this file');
      const ok = await confirmDialog({ title: 'Import drive values?', message: `Replace the staged values for ${plural(Object.keys(drives).length, 'drive')} with the ones in ${file.name}? Nothing is written to the drives until you apply.`, confirmText: 'Import' });
      if (!ok) return;
      updateProfiles(() => compactProfiles(drives, regs));
      toast('Drive values imported', 'success');
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  };

  const onParamsSaved = (saved) => {
    const rows = withCatalog(saved, catalogRef.current);
    const before = new Set(regs.map(regKey));
    setRegs(rows);
    setActive((a) => new Set(rows.map(regKey).filter((k) => a.has(k) || !before.has(k))));
    updateProfiles((p) => compactProfiles(p, rows));
    setParamsOpen(false);
  };

  const activeCount = regs.filter((r) => active.has(regKey(r))).length;
  const allActive = activeCount === regs.length;

  return (
    <div className="page page-wide">
      <div className="toolbar card">
        <div className="toolbar-row">
          <div className="toolbar-title">
            <div className="eyebrow">Drives in this configuration</div>
            <div className="drive-toggle-row">
              {allDrives.map((pos) => {
                const s = slaves.find((x) => x.position === pos);
                const on = included.includes(pos);
                return (
                  <button key={pos} type="button" className={`drive-toggle ${on ? 'on' : ''}`} onClick={() => toggleIncluded(pos)} disabled={busy}
                    title={s ? `${s.name} · ${stateLabel(s.state)}` : `Position ${pos}`}>
                    <span className={`sdot ${stateTone(s?.state)}`} />{jointLabel(pos)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="toolbar-actions">
            {reading
              ? <button className="btn btn-danger" onClick={() => { cancelRead.current = true; }}><Square size={12} fill="currentColor" /> Stop reading</button>
              : <button className="btn" onClick={() => readDrives(included)} disabled={busy}><Download size={15} /> Read {included.length === allDrives.length ? 'all drives' : plural(included.length, 'drive')}</button>}
            <button className="btn" onClick={() => setParamsOpen(true)} disabled={busy} title="Add, edit or remove settings in this list"><Settings2 size={15} /><span className="hide-sm">Edit list</span></button>
            <Menu label={<><MoreHorizontal size={16} /><span className="hide-sm">More</span></>} disabled={busy} items={[
              { label: 'Export CSV (staged + on drive)', icon: FileDown, onClick: exportCsv },
              { label: 'Export drive values (JSON)', icon: FileDown, onClick: exportJson },
              { label: 'Import drive values (JSON)…', icon: FileUp, onClick: () => importRef.current?.click() },
            ]} />
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); }} />
          </div>
        </div>
        {reading && (
          <div className="toolbar-progress">
            <Progress value={(reading.done / reading.total) * 100} />
            <span className="mono small muted">{reading.done}/{reading.total}</span>
          </div>
        )}
      </div>

      <div className="config-layout">
        <section className="card config-side" aria-label="Apply">
          <div className="apply-bar">
            <div className="apply-mode">
              <div className="seg seg-sm" role="radiogroup" aria-label="What to write">
                <button className={mode === 'changes' ? 'on' : ''} onClick={() => setMode('changes')} disabled={busy}>Changed values</button>
                <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')} disabled={busy}>All selected</button>
              </div>
              <p className="muted small">
                {mode === 'changes'
                  ? 'Only values that differ from what was read. Drives that were not read get every selected setting.'
                  : `All ${activeCount} selected registers to every drive.`}
              </p>
            </div>
            <div className="apply-summary">
              {plan.map((d) => (
                <div key={d.pos} className={`apply-row ${d.items.length ? 'has' : ''}`}>
                  <span className="joint">{jointLabel(d.pos)}</span>
                  <span className="small">{d.items.length ? plural(d.items.length, 'change') : 'up to date'}</span>
                  {!live[d.pos] && <span className="tag-warn" title="Not read yet">not read</span>}
                  {d.items.some((it) => it.error) && <span className="tag-danger">invalid</span>}
                </div>
              ))}
            </div>
            <button className="btn btn-primary btn-lg apply-go" onClick={openApply} disabled={busy || !totalWrites || invalid.length > 0}>
              <Upload size={16} /> Review &amp; apply {totalWrites ? `(${totalWrites})` : ''}
            </button>
          </div>
          {invalid.length > 0 && <div className="field-error apply-invalid">{plural(invalid.length, 'value')} invalid: {invalid.slice(0, 3).map((it) => `${jointLabel(it.pos)} ${it.reg.name}`).join(', ')}{invalid.length > 3 ? '…' : ''}</div>}
        </section>
        <div className="card config-main">
          <div className="card-head config-head">
            <div className="seg seg-sm" role="tablist" aria-label="View">
              <button className={view === 'matrix' ? 'on' : ''} onClick={() => setViewPref('matrix')}><Grid3x3 size={14} /> All drives</button>
              <button className={view === 'drive' ? 'on' : ''} onClick={() => setViewPref('drive')}><List size={14} /> One drive</button>
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 320 }}>
              <SearchInput value={query} onChange={setQuery} placeholder="Search settings or H-code" />
            </div>
            <label className="checkbox small"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /><Filter size={13} /> Only rows with differences</label>
            <span className={`save-state ${saveState}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}</span>
          </div>

          {view === 'matrix' ? (
            <MatrixView {...{ groups, included, slaves, profiles, live, results, active, setActive, regs, allActive, busy, setCell, clearCell, clearRow, clearDrive, loadFromDrive, copyDriveToAll, setTemplate, readDrives }} />
          ) : (
            <DriveView {...{ groups, included, drivePos, setFocusPos, slaves, profiles, live, results, active, setActive, busy, setCell, clearCell, clearDrive, loadFromDrive, readDrives }} />
          )}
        </div>

      </div>

      {paramsOpen && <ParamEditor regs={regs} onClose={() => setParamsOpen(false)} onSaved={onParamsSaved} />}
      {applyPlan && (
        <ApplyModal plan={applyPlan} masterId={masterId} onClose={() => setApplyPlan(null)} onCellResult={setResult} onLive={setLive} />
      )}
    </div>
  );
}

/* ── Matrix: registers × drives ─────────────────────────── */
function MatrixView({ groups, included, slaves, profiles, live, results, active, setActive, regs, allActive, busy, setCell, clearCell, clearRow, clearDrive, loadFromDrive, copyDriveToAll, setTemplate, readDrives }) {
  const [collapsed, setCollapsed] = useState({});
  const toggleAll = () => setActive(allActive ? new Set() : new Set(regs.map(regKey)));
  return (
    <div className="matrix-wrap">
      <table className="table cfg-matrix">
        <thead>
          <tr>
            <th className="sticky-col cfg-param">
              <label className="checkbox"><input type="checkbox" checked={allActive} onChange={toggleAll} disabled={busy} /> Setting</label>
            </th>
            <th className="cfg-tpl" title="Used by every drive that has no value of its own">All drives</th>
            {included.map((pos) => {
              const s = slaves.find((x) => x.position === pos);
              const read = !!live[pos];
              return (
                <th key={pos} className="cfg-drive">
                  <div className="cfg-drive-head">
                    <span className={`sdot ${stateTone(s?.state)}`} />
                    <span>{jointLabel(pos)}</span>
                    <Menu compact disabled={busy} label={<ChevronDown size={14} />} items={[
                      { label: `Read ${jointLabel(pos)}`, icon: Download, onClick: () => readDrives([pos]) },
                      { label: 'Use values read from drive', icon: Download, onClick: () => loadFromDrive(pos), disabled: !read },
                      { label: 'Copy these values to all drives', icon: Grid3x3, onClick: () => copyDriveToAll(pos) },
                      { label: 'Reset to template', icon: RotateCcw, onClick: () => clearDrive(pos) },
                    ]} />
                  </div>
                  <div className="cfg-drive-sub">{read ? 'read' : 'not read'}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, items]) => (
            <GroupBlock key={group} group={group} count={items.length} colSpan={2 + included.length}
              collapsed={!!collapsed[group]} onToggle={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}>
              {items.map((r) => {
                const k = regKey(r);
                const on = active.has(k);
                const tplErr = validateReg(r.defaultValue, r);
                const anyOverride = included.some((pos) => isOverride(profiles, pos, r));
                return (
                  <tr key={k} className={on ? '' : 'disabled'}>
                    <td className="sticky-col cfg-param">
                      <label className="checkbox cfg-param-label">
                        <input type="checkbox" checked={on} disabled={busy}
                          onChange={(e) => setActive((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                        <span title={r.description || undefined}>
                          <span className="cfg-name">{r.name}{r.units && <span className="cfg-units"> {r.units}</span>}</span>
                          <span className="cfg-reg mono">{easyCode(r.index, r.subindex) && <span className="easy">{easyCode(r.index, r.subindex)} · </span>}{addrText(r.index, r.subindex)} · {normDtype(r.dataType)}</span>
                        </span>
                      </label>
                    </td>
                    <td className="cfg-tpl">
                      <div className="cell-stack">
                        <ValueInput reg={r} className={`input input-sm mono ${tplErr ? 'invalid' : ''}`} value={r.defaultValue} disabled={busy}
                          title={tplErr || 'Value for all drives, unless a drive has its own'} onChange={(v) => setTemplate(r, v)} />
                        {anyOverride && <button className="link-btn" onClick={() => clearRow(r)} disabled={busy} title="Use the all-drives value on every drive">use for all</button>}
                      </div>
                    </td>
                    {included.map((pos) => (
                      <td key={pos} className="cfg-cell">
                        <Cell reg={r} pos={pos} profiles={profiles} live={live[pos]?.[k]} result={results[pos]?.[k]} disabled={busy || !on}
                          onChange={(v) => setCell(pos, r, v)} onReset={() => clearCell(pos, r)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </GroupBlock>
          ))}
          {groups.length === 0 && <tr><td colSpan={2 + included.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>No parameters match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({ group, count, colSpan, collapsed, onToggle, children }) {
  return (
    <>
      <tr className="group-row" onClick={onToggle}>
        <td colSpan={colSpan}>
          <span className="group-label">
            <ChevronDown size={14} style={{ transform: collapsed ? 'rotate(-90deg)' : undefined, transition: 'transform .15s' }} />
            {/^[0-9a-f]+h$/i.test(group) ? <span className="mono">{regLabel(group)}</span> : <span>{group}</span>}
            <span className="muted">{plural(count, 'setting')}</span>
          </span>
        </td>
      </tr>
      {!collapsed && children}
    </>
  );
}

const optionText = (reg, v) => {
  const o = reg.options?.find((x) => String(x.value) === String(v));
  return o ? `${o.value} (${o.label})` : String(v);
};

/**
 * Text box, or a list when the manual gives named values (e.g. DI functions).
 * "Other value…" switches back to a text box, since the manual does not
 * always name every allowed value.
 */
function ValueInput({ reg, value, onChange, ...rest }) {
  const v = String(value ?? '');
  const known = reg.options?.some((o) => String(o.value) === v);
  const [typing, setTyping] = useState(false);
  if (!reg.options?.length || typing || (v !== '' && !known)) {
    return <input {...rest} value={v} onChange={(e) => onChange(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} autoFocus={typing} />;
  }
  return (
    <select {...rest} className={`${rest.className || ''} opt-select`} title={known ? `${optionText(reg, v)}${rest.title ? ` · ${rest.title}` : ''}` : rest.title}
      value={known ? v : ''} onChange={(e) => (e.target.value === '__other' ? setTyping(true) : onChange(e.target.value))}>
      {!known && <option value="">(none)</option>}
      {reg.options.map((o) => <option key={o.value} value={String(o.value)}>{o.label} ({o.value})</option>)}
      <option value="__other">Other value…</option>
    </select>
  );
}

/** One editable drive value with what the drive reported and the last write result. */
function Cell({ reg, pos, profiles, live, result, disabled, onChange, onReset }) {
  const value = stagedValue(profiles, pos, reg);
  const override = isOverride(profiles, pos, reg);
  const err = validateReg(value, reg);
  const differs = live?.state === 'ok' && !sameValue(live.value, value, reg.dataType);
  return (
    <div className="cell-stack">
      <div className="cell-input">
        <ValueInput reg={reg} className={`input input-sm mono ${err ? 'invalid' : override ? 'override' : 'inherit'} ${differs ? 'pending' : ''}`}
          value={value} disabled={disabled} aria-label={`${reg.name} ${jointLabel(pos)}`}
          title={err || (override ? 'Value for this drive' : 'Follows the template')} onChange={onChange} />
        {override && !disabled && <button className="cell-reset" onClick={onReset} title="Back to the all-drives value"><RotateCcw size={11} /></button>}
      </div>
      <div className="cell-meta">
        <LiveValue live={live} differs={differs} reg={reg} />
        <ResultIcon result={result} />
      </div>
    </div>
  );
}

// Only differences get words; a matching or unread value stays quiet.
function LiveValue({ live, differs, reg }) {
  if (!live) return null;
  if (live.state === 'error') return <span className="lv lv-err" title={live.msg}><AlertTriangle size={11} /> read error</span>;
  if (!differs) return null;
  return <span className="lv lv-diff" title={`The drive currently has ${optionText(reg, live.value)}`}>drive: {String(live.value)}</span>;
}

function ResultIcon({ result }) {
  if (!result) return null;
  if (result.state === 'verified') return <CheckCircle2 size={13} className="ri ri-ok" aria-label="Verified" />;
  if (result.state === 'written') return <CheckCircle2 size={13} className="ri ri-written" aria-label="Written" />;
  return <span className="ri ri-bad" title={result.msg}><XCircle size={13} aria-label={result.msg} /></span>;
}

/* ── One drive at a time (phones, or by choice) ─────────── */
function DriveView({ groups, included, drivePos, setFocusPos, slaves, profiles, live, results, active, setActive, busy, setCell, clearCell, clearDrive, loadFromDrive, readDrives }) {
  const s = slaves.find((x) => x.position === drivePos);
  return (
    <div>
      <div className="drive-tabs">
        {included.map((pos) => {
          const x = slaves.find((y) => y.position === pos);
          return (
            <button key={pos} className={`drive-tab ${pos === drivePos ? 'on' : ''}`} onClick={() => setFocusPos(pos)}>
              <span className={`sdot ${stateTone(x?.state)}`} />{jointLabel(pos)}
            </button>
          );
        })}
      </div>
      <div className="drive-view-head">
        <div>
          <div style={{ fontWeight: 600 }}>{jointLabel(drivePos)} <span className="muted small">{s ? stateLabel(s.state) : ''}</span></div>
          <div className="muted small">{s?.name || ''}</div>
        </div>
        <div className="row-wrap">
          <button className="btn btn-sm" onClick={() => readDrives([drivePos])} disabled={busy}><Download size={13} /> Read</button>
          <button className="btn btn-sm" onClick={() => loadFromDrive(drivePos)} disabled={busy || !live[drivePos]}>Use drive values</button>
          <button className="btn btn-sm btn-ghost" onClick={() => clearDrive(drivePos)} disabled={busy}><RotateCcw size={13} /> Use all-drive values</button>
        </div>
      </div>
      <div className="reg-list">
        {groups.map(([group, items]) => (
          <div key={group} className="reg-group">
            <div className="reg-group-head">{/^[0-9a-f]+h$/i.test(group) ? <span className="mono">{regLabel(group)}</span> : group}</div>
            {items.map((r) => {
              const k = regKey(r);
              const on = active.has(k);
              return (
                <div key={k} className={`reg-item ${on ? '' : 'disabled'}`}>
                  <label className="checkbox reg-item-name">
                    <input type="checkbox" checked={on} disabled={busy}
                      onChange={(e) => setActive((st) => { const n = new Set(st); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                    <span title={r.description || undefined}>
                      <span className="cfg-name">{r.name}{r.units && <span className="cfg-units"> {r.units}</span>}</span>
                      <span className="cfg-reg mono">{addrLabel(r.index, r.subindex)} · all drives {String(r.defaultValue)}</span>
                    </span>
                  </label>
                  <div className="reg-item-value">
                    <Cell reg={r} pos={drivePos} profiles={profiles} live={live[drivePos]?.[k]} result={results[drivePos]?.[k]} disabled={busy || !on}
                      onChange={(v) => setCell(drivePos, r, v)} onReset={() => clearCell(drivePos, r)} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Small dropdown menu ────────────────────────────────── */
function Menu({ label, items, disabled, compact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className={`btn ${compact ? 'btn-ghost btn-icon btn-sm' : ''}`} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className="menu-item" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon && <it.icon size={14} />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
