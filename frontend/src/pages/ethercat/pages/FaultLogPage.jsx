import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Database, FileDown, Info, RotateCcw, Search, Square, X } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import ActivityLog from '../components/ActivityLog';
import { toast } from '../components/Toasts';
import { confirmDialog, Empty, Progress } from '../components/ui';
import { codeHex, faultCategory, formatRegister, lookupFault, SLOT_REGISTERS } from '../lib/faults';
import { jointLabel, plural, stateTone } from '../lib/format';
import { useActivityLog, useFaultDb, useMediaQuery } from '../lib/hooks';
import { recordHistory } from '../lib/history';
import { clearIntent, faultStatus, peekIntent } from '../lib/store';

const NUM_SLOTS = 9;
const SLOTS = Array.from({ length: NUM_SLOTS }, (_, i) => i + 1);
const FALLBACK_DRIVES = [0, 1, 2, 3, 4, 5];

// Results survive switching to another page and back.
// grid: pos -> slot -> entry; readAt: pos -> ISO time of the last read.
const memory = { grid: {}, readAt: {}, selected: null };

/** Read one slot from one drive via the server's atomic select+read endpoint. */
async function readSlot(masterId, pos, slot, index) {
  try {
    const r = await api.readFaultSlot(masterId, pos, slot);
    if (!r?.success) return { slot, registers: r?.registers || {}, faultCode: null, faultDetails: null, isEmpty: false, error: r?.error || r?.message || 'Read failed' };
    const code = r.registers['0x23'];
    return code
      ? { slot, registers: r.registers, faultCode: code, faultDetails: lookupFault(index, code), isEmpty: false }
      : { slot, registers: r.registers, faultCode: null, faultDetails: null, isEmpty: true };
  } catch (err) {
    return { slot, registers: {}, faultCode: null, faultDetails: null, isEmpty: false, error: err.message };
  }
}

const shortCode = (s) => s.faultDetails?.subFaultCode || codeHex(s.faultCode);
const faultLabel = (s) => (s.faultDetails ? `${s.faultDetails.subFaultCode} ${s.faultDetails.name}` : `Code ${codeHex(s.faultCode)}`);
const severity = (s) => (s.error ? 'err' : !s.faultCode ? 'clear' : faultCategory(s.faultDetails?.faultRange) === 'Warning' ? 'warn' : 'fault');
function slotSummary(s) {
  if (s.error) return s.error;
  if (s.isEmpty) return `Record ${s.slot}: no fault`;
  return `${codeHex(s.faultCode)}${s.faultDetails ? ` — ${s.faultDetails.subFaultCode} ${s.faultDetails.name}` : ' — not in fault DB'}`;
}

/** DS402 fault reset (the fault history in 0x200B is kept). */
function ResetButton({ pos, masterId, label = true }) {
  const [busy, setBusy] = useState(false);
  const reset = async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: `Fault reset ${jointLabel(pos)}?`,
      message: 'Clears the active fault so the drive can run again. The fault history is kept.',
      confirmText: 'Reset fault',
      tone: 'warn',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.resetDrive(masterId, pos);
      toast(r?.success ? `${jointLabel(pos)}: fault reset sent` : `Reset failed: ${r?.sdo_return_message}`, r?.success ? 'success' : 'error');
    } catch (err) {
      toast(`Reset failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-sm" onClick={reset} disabled={busy} title={`Clear the active fault on ${jointLabel(pos)}`}>
      {busy ? <span className="spinner" /> : <RotateCcw size={13} />}{label && <span>Reset</span>}
    </button>
  );
}

/* ── Detail of one slot ─────────────────────────────────── */
function SlotDetail({ pos, s, masterId, onClose }) {
  const sf = s.faultDetails;
  const sev = severity(s);
  return (
    <div className="fd">
      <div className="fd-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fd-where">{jointLabel(pos)} · record {s.slot}{s.slot === 1 ? ' (most recent)' : s.slot === NUM_SLOTS ? ' (oldest)' : ''}</div>
          <div className="fd-title">
            {s.error ? 'Could not read this record' : s.isEmpty ? 'No fault recorded' : sf ? <><span className="mono">{sf.subFaultCode}</span> {sf.name}</> : <>Unknown code <span className="mono">{codeHex(s.faultCode)}</span></>}
          </div>
        </div>
        {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close detail"><X size={16} /></button>}
      </div>

      {s.error && <div className="callout callout-warn small">{s.error}</div>}
      {sf && (
        <div className="fd-tags">
          <span className={`badge ${sev === 'warn' ? 'badge-warn' : 'badge-danger'}`}>{faultCategory(sf.faultRange)}</span>
          {sf.type && sf.type !== '-' && <span className="badge" title="Fault class from the drive manual: No.1 is the most serious">Class {sf.type.replace(/^No\.?\s*/, '')}</span>}
          {sf.resettable === 'Yes' || sf.resettable === 'No'
            ? <span className={`badge ${sf.resettable === 'Yes' ? 'badge-ok' : ''}`}>{sf.resettable === 'Yes' ? 'Resettable' : 'Needs power cycle'}</span>
            : <span className="badge">Reset type not listed</span>}
          {s.slot === 1 && sf.resettable !== 'No' && <span style={{ marginLeft: 'auto' }}><ResetButton pos={pos} masterId={masterId} /></span>}
        </div>
      )}
      {sf?.candidates && <div className="callout callout-info small">The drive reports {sf.candidates.join(' and ')} with the same code, so it cannot say which one it is. Causes for both are listed.</div>}
      {sf?.limitedInfo && <div className="callout callout-info small">Limited information: the SV660N manuals supplied list this code but do not describe it in detail.</div>}
      {!s.error && !s.isEmpty && !sf && <div className="callout callout-warn small">Code {codeHex(s.faultCode)} (dec {s.faultCode}) is not in the fault database.</div>}

      {!s.error && !s.isEmpty && (
        <>
          <div className="fd-section">Drive state when the fault happened</div>
          <dl className="fd-kv">
            {SLOT_REGISTERS.filter((r) => r.sub !== '0x23').map((reg) => (
              <div key={reg.sub}><dt>{reg.name}</dt><dd className="mono">{formatRegister(reg, s.registers?.[reg.sub])}</dd></div>
            ))}
            {sf && <div><dt>Error codes (for support)</dt><dd className="mono">{sf.errorCode603Fh} / {sf.auxiliaryCode203Fh}</dd></div>}
          </dl>
        </>
      )}

      {sf?.causesAndSolutions?.length > 0 && (
        <>
          <div className="fd-section">Possible causes ({sf.causesAndSolutions.length})</div>
          <ol className="fd-causes">
            {sf.causesAndSolutions.map((cs, i) => (
              <li key={i}>
                <div className="fd-cause">{cs.cause}</div>
                {cs.confirmingMethod && <div className="fd-step"><span>Check</span>{cs.confirmingMethod}</div>}
                {cs.solution && <div className="fd-step fix"><span>Fix</span>{cs.solution}</div>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────── */
export default function FaultLogPage() {
  const { slaves, masterId } = useApp();
  const { index, error: dbError } = useFaultDb();
  const log = useActivityLog();
  const narrow = useMediaQuery('(max-width: 960px)');
  const [grid, setGridState] = useState(memory.grid);
  const [readAt, setReadAt] = useState(memory.readAt);
  const [selected, setSelectedRaw] = useState(memory.selected); // { pos, slot }
  const [busy, setBusy] = useState(null); // { kind, done, total }
  const [oneSlot, setOneSlot] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const cancelRef = useRef(false);
  const detailRef = useRef(null);

  const setGrid = (fn) => setGridState((g) => { const n = fn(g); memory.grid = n; return n; });
  const select = (sel) => {
    memory.selected = sel;
    setSelectedRaw(sel);
    if (sel && narrow) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  // Opened from the overview for one drive → read only that drive until "All drives".
  const [onlyPos, setOnlyPos] = useState(() => peekIntent('faults')?.pos ?? null);
  useEffect(() => { clearIntent('faults'); }, []);
  const allDrives = useMemo(() => (slaves.length ? slaves.map((s) => s.position) : FALLBACK_DRIVES), [slaves]);
  const drives = useMemo(() => (onlyPos !== null && allDrives.includes(onlyPos) ? [onlyPos] : allDrives), [onlyPos, allDrives]);

  const saveSnapshot = async (m, data, slotNum) => {
    try {
      const r = await api.saveErrorLog({ savedAt: new Date().toISOString(), mode: m, slot: slotNum, masterId, data });
      log.add(r?.success ? `Snapshot saved to error_log.json (${r.totalSnapshots} total)` : `Snapshot not saved: ${r?.message}`, r?.success ? 'ok' : 'warn');
    } catch (err) {
      log.add(`Snapshot not saved: ${err.message}`, 'err');
    }
  };

  /** Read the given slots on every drive in scope. */
  const read = async (slots) => {
    const full = slots.length === NUM_SLOTS;
    cancelRef.current = false;
    const total = drives.length * slots.length;
    let done = 0;
    setBusy({ kind: full ? 'full' : 'slot', done, total });
    log.add(full ? `Full history: ${NUM_SLOTS} slots × ${plural(drives.length, 'drive')}…` : `Reading slot ${slots[0]} from ${plural(drives.length, 'drive')}…`);
    const results = []; // { driver, fetchedAt, slots: [...] }
    for (const pos of drives) {
      if (cancelRef.current) break;
      const entry = { driver: pos, fetchedAt: new Date().toISOString(), slots: [] };
      if (full) setGrid((g) => ({ ...g, [pos]: {} }));
      for (const s of slots) {
        if (cancelRef.current) break;
        const r = await readSlot(masterId, pos, s, index);
        entry.slots.push(r);
        setGrid((g) => ({ ...g, [pos]: { ...g[pos], [s]: r } }));
        setBusy({ kind: full ? 'full' : 'slot', done: ++done, total });
        if (r.faultCode) log.add(`${jointLabel(pos)} slot ${s}: ${slotSummary(r)}`, 'err');
        else if (r.error) log.add(`${jointLabel(pos)} slot ${s}: ${r.error}`, 'warn');
      }
      if (entry.slots.length === slots.length) {
        results.push(entry);
        setReadAt((t) => { const n = { ...t, [pos]: entry.fetchedAt }; memory.readAt = n; return n; });
      }
    }
    setBusy(null);
    const cancelled = cancelRef.current;
    const faults = results.reduce((n, d) => n + d.slots.filter((x) => x.faultCode).length, 0);
    log.add(cancelled ? 'Stopped.' : `Done: ${plural(faults, 'fault')} on ${plural(results.length, 'drive')}.`, cancelled ? 'warn' : 'ok');

    // Slot 1 is "the current fault"; a full read also gives the history.
    if (slots.includes(1) && results.length) {
      faultStatus.set((st) => ({
        ...st,
        ...Object.fromEntries(results.map((d) => [d.driver, {
          at: d.fetchedAt, mode: full ? 'blackbox' : 'slot',
          error: d.slots.every((x) => x.error) ? d.slots[0].error : null,
          faults: d.slots.filter((x) => x.faultCode).map((x) => ({ slot: x.slot, label: full ? `Record ${x.slot}: ${faultLabel(x)}` : faultLabel(x) })),
        }])),
      }));
    }
    if (cancelled) return;
    if (full) {
      saveSnapshot('complete', results, null);
      recordHistory({
        kind: 'faults', outcome: 'info', drives: results.map((d) => d.driver),
        title: `Full fault history read: ${plural(faults, 'fault')} on ${plural(results.length, 'drive')}`,
        detail: results.map((d) => `${jointLabel(d.driver)}: ${d.slots.filter((x) => x.faultCode).map((x) => `slot ${x.slot} ${slotSummary(x)}`).join('; ') || 'clear'}`).join('\n'),
      });
    } else {
      const flat = results.map((d) => ({ driver: d.driver, fetchedAt: d.fetchedAt, ...d.slots[0] }));
      saveSnapshot('specific', flat, slots[0]);
      const faulted = flat.filter((e) => e.faultCode);
      recordHistory({
        kind: 'faults', outcome: flat.some((e) => e.error) ? 'partial' : 'info', drives: flat.map((e) => e.driver),
        title: `${slots[0] === 1 ? 'Latest fault' : `Fault record ${slots[0]}`} read: ${faulted.length ? `${plural(faulted.length, 'drive')} with a fault` : 'no faults'}`,
        detail: flat.map((e) => `${jointLabel(e.driver)}: ${slotSummary(e)}`).join('\n'),
      });
    }
    // Point at the newest fault so the detail panel isn't empty.
    if (!selected || !grid[selected.pos]?.[selected.slot]) {
      for (const s of slots) {
        const d = results.find((x) => x.slots.find((y) => y.slot === s && y.faultCode));
        if (d) { select({ pos: d.driver, slot: s }); break; }
      }
    }
  };

  const fullResults = drives.filter((pos) => SLOTS.every((s) => grid[pos]?.[s]))
    .map((pos) => ({ driver: pos, fetchedAt: readAt[pos], slots: SLOTS.map((s) => grid[pos][s]) }));

  const exportPdf = async () => {
    setExporting(true);
    try {
      const { generateFaultReport } = await import('../lib/pdfReport');
      const r = await generateFaultReport({ results: fullResults, masterId, numSlots: NUM_SLOTS });
      log.add(`PDF saved: ${r.fname} (${r.pages} pages)`, 'ok');
    } catch (err) {
      toast(`PDF export failed: ${err.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  // Summary for the drives in scope.
  const summary = useMemo(() => {
    let active = 0, history = 0, errors = 0, clear = 0, read = 0;
    for (const pos of drives) {
      const row = grid[pos];
      if (!row || !Object.keys(row).length) continue;
      read++;
      const vals = Object.values(row);
      if (row[1]?.faultCode) active++;
      else if (vals.some((v) => v.faultCode)) history++;
      else if (vals.some((v) => v.error)) errors++;
      else clear++;
    }
    return { active, history, errors, clear, read };
  }, [grid, drives]);

  // Faults that repeat across slots and drives point at a common cause.
  const recurring = useMemo(() => {
    const m = new Map();
    for (const pos of drives) {
      for (const s of SLOTS) {
        const e = grid[pos]?.[s];
        if (!e?.faultCode) continue;
        const k = String(e.faultCode);
        if (!m.has(k)) m.set(k, { entry: e, hits: [] });
        m.get(k).hits.push({ pos, slot: s });
      }
    }
    return [...m.values()].sort((a, b) => b.hits.length - a.hits.length);
  }, [grid, drives]);

  const sel = selected && grid[selected.pos]?.[selected.slot] ? selected : null;
  const anyRead = summary.read > 0;
  const lastRead = Object.values(readAt).sort().pop();

  return (
    <div className="page">
      {dbError && <div className="callout callout-warn small"><Info size={15} /> Fault database not loaded ({dbError}). Codes show without descriptions.</div>}
      {onlyPos !== null && drives.length === 1 && (
        <div className="callout callout-info small row">
          <Info size={15} /> <span>Showing {jointLabel(onlyPos)} only.</span>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOnlyPos(null)} disabled={!!busy}><X size={13} /> All drives</button>
        </div>
      )}
      {!slaves.length && <div className="callout callout-info small"><Info size={15} /> No drives found yet, so drives J1–J6 are read. Press the refresh button at the top right to find the real drives.</div>}

      <section className="card">
        <div className="fault-bar">
          <div className="fault-bar-text">
            <div className="card-title">Read fault history</div>
            <div className="muted small">Each drive remembers its last {NUM_SLOTS} faults. Record 1 is the most recent.</div>
          </div>
          <div className="fault-bar-actions">
            {busy ? (
              <button className="btn btn-danger" onClick={() => { cancelRef.current = true; }}><Square size={12} fill="currentColor" /> Stop</button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => read([1])}><Search size={14} /> Read latest fault</button>
                <button className="btn" onClick={() => read(SLOTS)}><Database size={14} /> Read full history</button>
                <div className="input-group">
                  <select className="input select" value={oneSlot} onChange={(e) => setOneSlot(Number(e.target.value))} aria-label="Record to read" title="Read one record (1 = most recent)">
                    {SLOTS.map((n) => <option key={n} value={n}>Record {n}</option>)}
                  </select>
                  <button className="btn" onClick={() => read([oneSlot])}>Read</button>
                </div>
              </>
            )}
          </div>
        </div>
        {busy && (
          <div className="toolbar-progress">
            <Progress value={(busy.done / busy.total) * 100} />
            <span className="mono small muted">{busy.done}/{busy.total}</span>
          </div>
        )}
        {anyRead && (
          <div className="fault-summary">
            <span className={`fs ${summary.active ? 'fault' : ''}`}><b>{summary.active}</b> active fault{summary.active === 1 ? '' : 's'}</span>
            <span className={`fs ${summary.history ? 'warn' : ''}`}><b>{summary.history}</b> had faults before</span>
            <span className="fs"><b>{summary.clear}</b> no faults</span>
            {summary.errors > 0 && <span className="fs warn"><b>{summary.errors}</b> not readable</span>}
            {lastRead && <span className="fs muted">read {new Date(lastRead).toLocaleTimeString('en-GB', { hour12: false })}</span>}
          </div>
        )}
      </section>

      {!anyRead && !busy ? (
        <section className="card">
          <Empty icon={Search} title="No faults read yet">
            Use <strong>Read latest fault</strong> for a quick check of every drive, or <strong>Read full history</strong> to see each drive's last {NUM_SLOTS} faults and save a PDF report.
          </Empty>
        </section>
      ) : (
        <div className={`fault-layout ${sel ? 'has-detail' : ''}`}>
          <div className="stack">
            <section className="card">
              <div className="card-head">
                <div className="card-title">Fault map</div>
                <span className="card-sub hide-xs">newest on the left · click a fault for details</span>
                <div className="card-actions">
                  <button className="btn btn-sm" onClick={exportPdf} disabled={exporting || !!busy || !fullResults.length}
                    title={fullResults.length ? 'PDF report of the full history' : 'Read the full history first'}>
                    {exporting ? <span className="spinner" /> : <FileDown size={13} />} PDF
                  </button>
                </div>
              </div>
              <div className="fmap-wrap">
                <table className="fmap">
                  <thead>
                    <tr>
                      <th className="fmap-drive">Drive</th>
                      {SLOTS.map((s) => <th key={s} className={s === 1 ? 'now' : ''}>{s === 1 ? 'Latest' : s}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {drives.map((pos) => {
                      const sl = slaves.find((x) => x.position === pos);
                      const active = grid[pos]?.[1]?.faultCode;
                      return (
                        <tr key={pos}>
                          <th className="fmap-drive" scope="row">
                            <div className="fmap-drive-in">
                              <span className={`sdot ${stateTone(sl?.state)}`} />
                              <span className="mono">{jointLabel(pos)}</span>
                              {active && <ResetButton pos={pos} masterId={masterId} label={false} />}
                            </div>
                          </th>
                          {SLOTS.map((s) => {
                            const e = grid[pos]?.[s];
                            const isSel = sel?.pos === pos && sel?.slot === s;
                            if (!e) return <td key={s} className={`fcell none ${s === 1 ? 'now' : ''}`} />;
                            const sev = severity(e);
                            return (
                              <td key={s} className={`fcell ${sev} ${s === 1 ? 'now' : ''}`}>
                                <button className={isSel ? 'sel' : ''} onClick={() => select(isSel ? null : { pos, slot: s })}
                                  title={`${jointLabel(pos)} record ${s}: ${slotSummary(e)}`}>
                                  {sev === 'clear' ? '·' : sev === 'err' ? '!' : shortCode(e)}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="fmap-legend">
                <span><i className="fault" /> Fault</span><span><i className="warn" /> Warning</span><span><i className="clear" /> No fault</span><span><i className="err" /> Not readable</span>
              </div>
            </section>

            {recurring.length > 0 && (
              <section className="card">
                <div className="card-head"><div className="card-title">Faults found</div><span className="card-sub">most frequent first</span></div>
                <div className="fault-list">
                  {recurring.map(({ entry, hits }) => (
                    <button key={entry.faultCode} className="fault-item" onClick={() => select(hits[0])}>
                      <span className={`fi-code mono ${severity(entry)}`}>{shortCode(entry)}</span>
                      <span className="fi-main">
                        <span className="fi-name">{entry.faultDetails?.name || 'Not in fault database'}</span>
                        <span className="fi-where">{[...new Set(hits.map((h) => jointLabel(h.pos)))].join(', ')}{hits.some((h) => h.slot === 1) ? ' · active now' : ''}</span>
                      </span>
                      <span className="fi-count">{hits.length}×</span>
                      <ChevronRight size={15} className="muted" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="card fault-detail" ref={detailRef}>
            {sel
              ? <SlotDetail pos={sel.pos} s={grid[sel.pos][sel.slot]} masterId={masterId} onClose={() => select(null)} />
              : <div className="fd-empty muted small">Click a fault in the map to see what caused it, what the drive was doing at the time, and how to fix it.</div>}
          </aside>
        </div>
      )}

      <div className="log-toggle">
        <button className="link-btn" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide' : 'Show'} read log ({log.lines.length})</button>
      </div>
      {showLog && <ActivityLog lines={log.lines} onClear={log.clear} title="Read log" />}
    </div>
  );
}
