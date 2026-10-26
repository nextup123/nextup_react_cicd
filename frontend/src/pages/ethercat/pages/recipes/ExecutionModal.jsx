import { useCallback, useEffect, useRef, useState } from 'react';
import { useDriveWork } from '../../lib/driveWork';
import { CheckCircle2, FileDown, Play, RotateCcw, Square, XCircle } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../context/AppContext';
import { toast } from '../../components/Toasts';
import { confirmDialog, Modal, Progress } from '../../components/ui';
import { checkExpected } from '../../lib/expected';
import { jointLabel, normDtype, plural, sleep } from '../../lib/format';
import { csvRow, downloadFile, recordHistory, stamp } from '../../lib/history';
import { ALIVE_PROBE, isRefusal, RESTART_POLL_MS, RESTART_TIMEOUT_MS, restartsDrive } from '../../lib/restart';
import { addrLabel, easyCode } from '../../lib/params';
import { driveAllowed } from './recipeModel';

const CELL_TEXT = { pending: '·', skipped: 'skip', cancelled: '—' };

/**
 * Runs a recipe from the browser, step by step, so every cell of the
 * matrix updates live.
 *
 * Changes from the old runner:
 *  - the step delay is applied once per step (after all drives), not once per
 *    drive — a 5 s "software reset" wait on 6 drives took 30 s before;
 *  - a failed write no longer skips the delay that follows it;
 *  - optional "stop drive on first error" so a drive doesn't continue a
 *    sequence after a step it depends on failed;
 *  - cancel interrupts waits immediately instead of after the current delay;
 *  - run statistics are recorded server-side without re-saving every recipe.
 */
export default function ExecutionModal({ recipe, slaves: targets, onClose, onExecuted }) {
  const { masterId, slaves } = useApp();
  // Never run on a drive the recipe isn't set up for (re-runs included).
  const [driveList, setDriveList] = useState(() => targets.filter((p) => driveAllowed(recipe, p)));
  // Highest position first, as before.
  const order = [...driveList].sort((a, b) => b - a);
  const blocks = recipe.blocks;

  const [phase, setPhase] = useState('confirm'); // confirm | running | done
  const [stopOnError, setStopOnError] = useState(true);
  const [cells, setCells] = useState({});
  const [current, setCurrent] = useState(null);
  const [waitNote, setWaitNote] = useState('');
  const [summary, setSummary] = useState(null);
  const [failedList, setFailedList] = useState([]);
  const abortRef = useRef(null);
  useDriveWork(phase === 'running', `Recipe "${recipe.name}" is running`);

  const setCell = useCallback((bi, pos, cell) => setCells((c) => ({ ...c, [`${bi}:${pos}`]: cell })), []);

  const run = async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase('running');
    setCells({});
    const failedDrives = new Set();
    const failures = []; // one per failed step per drive, for History
    const stored = {};
    let ok = 0;
    let failed = 0;
    let skipped = 0;

    for (let bi = 0; bi < blocks.length && !abort.signal.aborted; bi++) {
      const b = blocks[bi];
      setCurrent(bi);
      let ranAny = false;
      const restarting = []; // drives that were sent a restart in this step
      for (const pos of order) {
        if (abort.signal.aborted) break;
        if (stopOnError && failedDrives.has(pos)) {
          setCell(bi, pos, { state: 'skipped', msg: 'Skipped — an earlier step failed on this drive' });
          skipped++;
          const f = failures.find((x) => x.drive === pos);
          if (f) f.skipped++;
          continue;
        }
        setCell(bi, pos, { state: 'running' });
        ranAny = true;
        const fail = (error, extra = {}) => failures.push({
          drive: pos, step: bi + 1, name: b.name || `Step ${bi + 1}`, action: b.type === 'get' ? 'read' : 'write',
          address: addrLabel(b.index, b.subindex), value: b.type === 'get' ? '' : String(b.value), error, skipped: 0, ...extra,
        });
        const payload = {
          master_id: masterId, slave_position: pos,
          sdo_index: b.index, sdo_subindex: b.subindex, sdo_data_type: normDtype(b.dataType),
        };
        try {
          if (b.type === 'get') {
            const r = await api.sdoGet(payload);
            if (!r?.success) throw new Error(r?.sdo_return_message || 'SDO read failed');
            const value = r.sdo_return_value_string && normDtype(b.dataType) === 'string' ? r.sdo_return_value_string : r.sdo_return_value;
            const check = checkExpected(b.expectedValue, value);
            if (b.storeAs) (stored[pos] ||= {})[b.storeAs] = value;
            setCell(bi, pos, { state: check.pass ? 'ok' : 'error', value, msg: check.message });
            if (check.pass) ok++; else { failed++; failedDrives.add(pos); fail(check.message || `Unexpected value ${value}`, { action: 'check', value: String(value) }); }
          } else if (restartsDrive(b)) {
            // The drive reboots while handling this write, so a missing
            // confirmation is expected. Only a refusal (abort) is a failure;
            // whether it worked is decided by the drive coming back.
            let r;
            try { r = await api.sdoSet({ ...payload, sdo_value: String(b.value) }); } catch (err) { r = { success: false, sdo_return_message: err.message }; }
            if (!r?.success && isRefusal(r?.sdo_return_message)) throw new Error(r.sdo_return_message);
            setCell(bi, pos, { state: 'running', msg: 'Restart sent. Waiting for the drive to come back…' });
            restarting.push(pos);
          } else {
            const r = await api.sdoSet({ ...payload, sdo_value: String(b.value) });
            if (!r?.success) throw new Error(r?.sdo_return_message || 'SDO write failed');
            setCell(bi, pos, { state: 'ok', msg: `Wrote ${b.value}${r.sdo_return_message ? ` — ${r.sdo_return_message}` : ''}` });
            ok++;
          }
        } catch (err) {
          setCell(bi, pos, { state: 'error', msg: err.message });
          failed++;
          failedDrives.add(pos);
          fail(err.message);
        }
      }
      if (restarting.length) {
        // Give the drive the step's wait to go down, then poll until it answers again.
        await sleep(Math.max(b.delay || 0, 2000), abort.signal);
        const deadline = Date.now() + RESTART_TIMEOUT_MS;
        let waiting = [...restarting];
        while (waiting.length && !abort.signal.aborted) {
          setWaitNote(`Waiting for ${waiting.map(jointLabel).join(', ')} to restart`);
          const still = [];
          for (const pos of waiting) {
            let back = false;
            try { back = !!(await api.sdoGet({ master_id: masterId, slave_position: pos, ...ALIVE_PROBE }, { timeout: 6000 }))?.success; } catch { /* still restarting */ }
            if (back) { setCell(bi, pos, { state: 'ok', msg: 'Drive restarted and is answering again' }); ok++; } else still.push(pos);
          }
          waiting = still;
          if (!waiting.length || Date.now() > deadline) break;
          await sleep(RESTART_POLL_MS, abort.signal);
        }
        setWaitNote('');
        for (const pos of waiting) {
          if (abort.signal.aborted) break;
          const msg = `The drive did not answer within ${RESTART_TIMEOUT_MS / 1000} s after the restart`;
          setCell(bi, pos, { state: 'error', msg });
          failed++;
          failedDrives.add(pos);
          failures.push({
            drive: pos, step: bi + 1, name: b.name || `Step ${bi + 1}`, action: 'write',
            address: addrLabel(b.index, b.subindex), value: String(b.value), error: msg, skipped: 0,
          });
        }
      } else if (ranAny && bi < blocks.length - 1 && b.delay > 0) await sleep(b.delay, abort.signal);
    }

    const cancelled = abort.signal.aborted;
    setCurrent(null);
    setWaitNote('');
    if (cancelled) {
      setCells((c) => {
        const next = { ...c };
        blocks.forEach((_, bi) => order.forEach((pos) => {
          const k = `${bi}:${pos}`;
          if (!next[k] || next[k].state === 'running') next[k] = { state: 'cancelled', msg: 'Cancelled' };
        }));
        return next;
      });
    }
    setSummary({ ok, failed, skipped, cancelled, stored, failures });
    setPhase('done');
    abortRef.current = null;

    if (cancelled) toast('Recipe run cancelled', 'warn');
    else if (failed) toast(`"${recipe.name}" finished with ${plural(failed, 'error')}`, 'error');
    else toast(`"${recipe.name}" completed on ${plural(order.length, 'drive')}`, 'success');

    recordHistory({
      kind: 'recipe',
      outcome: cancelled ? 'cancelled' : failed ? (ok ? 'partial' : 'failed') : 'ok',
      title: `Recipe "${recipe.name}" on ${order.map(jointLabel).join(', ')}`,
      drives: order,
      stats: { ok, failed, skipped },
      failures,
      detail: failures.length
        ? failures.map((f) => `${jointLabel(f.drive)} · step ${f.step} "${f.name}" (${f.action} ${f.address}${f.value && f.action === 'write' ? ` = ${f.value}` : ''}): ${f.error}${f.skipped ? ` · ${plural(f.skipped, 'later step')} skipped` : ''}`).join('\n')
          + (cancelled ? '\nCancelled by the operator' : '')
        : cancelled ? 'Cancelled by the operator' : `${plural(blocks.length, 'step')} completed on every drive`,
    });
    setFailedList([...failedDrives]);

    if (!cancelled) {
      try {
        const info = await api.markRecipeExecuted(recipe.id);
        if (info?.success) onExecuted(recipe.id, info);
      } catch { /* stats are nice-to-have */ }
    }
  };

  const cancel = async () => {
    const ok = await confirmDialog({
      title: 'Cancel run?',
      message: 'The step in progress finishes; nothing after it is sent.',
      confirmText: 'Cancel run',
      cancelText: 'Keep running',
      tone: 'danger',
    });
    if (ok) abortRef.current?.abort();
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  // Re-run the whole recipe on the drives that failed (from step 1: a later
  // step may depend on an earlier one, so resuming mid-sequence isn't safe).
  const retryFailed = () => {
    setDriveList(failedList.filter((p) => driveAllowed(recipe, p)));
    setCells({});
    setSummary(null);
    setPhase('confirm');
  };

  const exportCsv = () => {
    const rows = [csvRow(['Step', 'Type', 'Register', ...order.map(jointLabel)])];
    blocks.forEach((b, bi) => {
      rows.push(csvRow([`${bi + 1}. ${b.name}`, b.type === 'get' ? 'Read' : 'Write', addrLabel(b.index, b.subindex),
        ...order.map((pos) => { const c = cells[`${bi}:${pos}`]; return c ? `${c.state}${c.value !== undefined ? ` (${c.value})` : ''}${c.state === 'error' && c.msg ? `: ${c.msg}` : ''}` : ''; })]));
    });
    downloadFile(`recipe_run_${recipe.name.replace(/[^a-z0-9]+/gi, '_')}_${stamp()}.csv`, rows.join('\n'), 'text/csv');
  };

  const total = blocks.length * order.length;
  const done = Object.values(cells).filter((c) => c.state !== 'running').length;
  const slaveName = (pos) => slaves.find((s) => s.position === pos)?.name || '';

  return (
    <Modal open size="modal-xl" dismissable={phase !== 'running'} onClose={onClose} labelledBy="exec-title">
      <div className="modal-head">
        <div className={`modal-icon ${phase === 'done' ? (summary?.failed || summary?.cancelled ? 'warn' : 'ok') : ''}`}>
          {phase === 'done' ? (summary?.failed || summary?.cancelled ? <XCircle size={18} /> : <CheckCircle2 size={18} />) : <Play size={17} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="exec-title">{recipe.name}</h3>
          <div className="muted small">
            {plural(blocks.length, 'step')} × {plural(order.length, 'drive')} · runs {order.map(jointLabel).join(' → ')}
          </div>
        </div>
        {phase === 'running' && (
          <div style={{ width: 200 }}>
            <Progress value={(done / total) * 100} />
            <div className="muted small" style={{ marginTop: 4, textAlign: 'right' }}>
              {waitNote || <>Step {current !== null ? current + 1 : '–'} of {blocks.length} · {done}/{total}</>}
            </div>
          </div>
        )}
      </div>

      <div className="modal-body stack">
        {phase === 'confirm' && (
          <>
            {recipe.notes && <div className="callout callout-warn small" style={{ whiteSpace: 'pre-line' }}>{recipe.notes}</div>}
            <label className="checkbox">
              <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
              Stop a drive's sequence after its first failed step
            </label>
          </>
        )}

        <div className="matrix" style={{ gridTemplateColumns: `minmax(220px, 1.6fr) repeat(${order.length}, minmax(76px, 1fr))` }}>
          <div className="mx-corner">Step</div>
          {order.map((pos) => (
            <div key={pos} className="mx-head" title={slaveName(pos)}>
              <div style={{ fontWeight: 650 }}>{jointLabel(pos)}</div>
            </div>
          ))}
          {blocks.map((b, bi) => (
            <div key={bi} style={{ display: 'contents' }}>
              <div className="mx-step" style={current === bi ? { background: 'var(--accent-soft)' } : undefined}>
                <span className="n"><span className={`type-tag type-${b.type}`}>{b.type === 'get' ? 'Read' : 'Write'}</span> {b.name}</span>
                <span className="m">
                  {b.type === 'set' ? `Set to ${b.value}` : b.expectedValue ? `Read, should be ${b.expectedValue}` : 'Read value'}
                  {restartsDrive(b) ? ' · drive restarts' : ''}
                  {easyCode(b.index, b.subindex) ? ` · ${easyCode(b.index, b.subindex)}` : ''}
                  {bi < blocks.length - 1 && b.delay > 0 ? ` · wait ${b.delay >= 1000 ? `${b.delay / 1000} s` : `${b.delay} ms`}` : ''}
                </span>
              </div>
              {order.map((pos) => {
                const c = cells[`${bi}:${pos}`] || { state: 'pending' };
                return (
                  <div key={pos} className={`mx-cell ${c.state}`} title={c.msg || c.state}>
                    {c.state === 'running' ? <span className="spinner" />
                      : c.state === 'ok' ? (c.value !== undefined ? String(c.value) : <CheckCircle2 size={18} />)
                        : c.state === 'error' ? (c.value !== undefined ? String(c.value) : <XCircle size={18} />)
                          : CELL_TEXT[c.state]}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {phase === 'done' && summary && (
          <div className={`callout ${summary.failed || summary.cancelled ? 'callout-warn' : 'callout-ok'}`}>
            {summary.failed || summary.cancelled ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{summary.cancelled ? 'Cancelled. ' : ''}
            {summary.ok} succeeded · {summary.failed} failed{summary.skipped ? ` · ${summary.skipped} skipped` : ''}.
            {summary.failed > 0 && ' This is also saved in History.'}</span>
          </div>
        )}
        {phase === 'done' && summary?.failures?.length > 0 && (
          <div className="run-failures">
            <div className="label">What failed</div>
            {summary.failures.map((f, i) => (
              <div key={i} className="run-failure">
                <XCircle size={14} />
                <span><strong>{jointLabel(f.drive)} · step {f.step}</strong> {f.name}: <span className="text-danger">{f.error}</span>
                  {f.skipped > 0 && <span className="muted"> · {plural(f.skipped, 'later step')} skipped</span>}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="modal-foot">
        {phase === 'confirm' && (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-success" onClick={run}><Play size={14} fill="currentColor" /> Start run</button>
          </>
        )}
        {phase === 'running' && <button className="btn btn-danger" onClick={cancel}><Square size={13} fill="currentColor" /> Cancel run</button>}
        {phase === 'done' && (
          <>
            <button className="btn" onClick={exportCsv}><FileDown size={14} /> Export CSV</button>
            {failedList.length > 0 && !summary?.cancelled && (
              <button className="btn" onClick={retryFailed}><RotateCcw size={14} /> Re-run on {failedList.map(jointLabel).join(', ')}</button>
            )}
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </Modal>
  );
}
