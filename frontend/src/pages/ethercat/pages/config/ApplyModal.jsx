import { useEffect, useRef, useState } from 'react';
import { useDriveWork } from '../../lib/driveWork';
import { ArrowRight, CheckCircle2, RotateCcw, ShieldCheck, Square, Upload, XCircle } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog, Modal, Progress } from '../../components/ui';
import { toast } from '../../components/Toasts';
import { jointLabel, normDtype, plural, sleep } from '../../lib/format';
import { recordHistory } from '../../lib/history';
import { sameValue } from './configModel';
import { addrLabel } from '../../lib/params';

const WRITE_GAP_MS = 200;

/**
 * Review → write → verify, for every drive in one go.
 * `plan` is [{ pos, items: [{ reg, key, from, to }] }]. Drives are written one
 * after another; each drive's values are read back afterwards when verify is on.
 * Reports per-cell outcomes through onCellResult(pos, key, result).
 */
export default function ApplyModal({ plan: initialPlan, masterId, onClose, onCellResult, onLive }) {
  const [plan, setPlan] = useState(initialPlan);
  const [phase, setPhase] = useState('review'); // review | running | done
  useDriveWork(phase === 'running', 'Drive settings are being written');
  const [verify, setVerify] = useState(true);
  const [status, setStatus] = useState({}); // pos -> { done, ok, failed, verifying, mismatched, errors: [] }
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const totalWrites = plan.reduce((n, d) => n + d.items.length, 0);

  const run = async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase('running');
    const total = totalWrites * (verify ? 2 : 1);
    let done = 0;
    setProgress({ done, total });
    const st = Object.fromEntries(plan.map((d) => [d.pos, { done: 0, ok: 0, failed: 0, mismatched: 0, verifying: false, errors: [] }]));
    const push = () => setStatus(structuredClone(st));
    push();

    for (const d of plan) {
      if (abort.signal.aborted) break;
      const s = st[d.pos];
      const written = [];
      for (const it of d.items) {
        if (abort.signal.aborted) break;
        const payload = { master_id: masterId, slave_position: d.pos, sdo_index: it.reg.index, sdo_subindex: it.reg.subindex, sdo_data_type: normDtype(it.reg.dataType) };
        try {
          const r = await api.sdoSet({ ...payload, sdo_value: it.to });
          if (!r?.success) throw new Error(r?.sdo_return_message || 'Write failed');
          s.ok++;
          written.push(it);
          onCellResult(d.pos, it.key, { state: 'written', msg: `Wrote ${it.to}` });
          if (!verify) onLive(d.pos, it.key, { state: 'ok', value: it.to });
        } catch (err) {
          s.failed++;
          s.errors.push({ key: it.key, name: it.reg.name, msg: err.message });
          onCellResult(d.pos, it.key, { state: 'failed', msg: err.message });
        }
        s.done++;
        setProgress({ done: ++done, total });
        push();
        await sleep(WRITE_GAP_MS, abort.signal);
      }

      if (verify && !abort.signal.aborted) {
        s.verifying = true;
        push();
        for (const it of written) {
          if (abort.signal.aborted) break;
          try {
            const r = await api.sdoGet({ master_id: masterId, slave_position: d.pos, sdo_index: it.reg.index, sdo_subindex: it.reg.subindex, sdo_data_type: normDtype(it.reg.dataType) });
            if (!r?.success) throw new Error(r?.sdo_return_message || 'Read-back failed');
            const value = normDtype(it.reg.dataType) === 'string' ? r.sdo_return_value_string : r.sdo_return_value;
            onLive(d.pos, it.key, { state: 'ok', value });
            if (sameValue(value, it.to, it.reg.dataType)) {
              onCellResult(d.pos, it.key, { state: 'verified', msg: `Verified ${value}` });
            } else {
              s.mismatched++;
              s.errors.push({ key: it.key, name: it.reg.name, msg: `Drive reports ${value} after writing ${it.to}` });
              onCellResult(d.pos, it.key, { state: 'mismatch', msg: `Drive reports ${value}, expected ${it.to}` });
            }
          } catch (err) {
            s.mismatched++;
            s.errors.push({ key: it.key, name: it.reg.name, msg: `Read-back: ${err.message}` });
            onCellResult(d.pos, it.key, { state: 'mismatch', msg: `Read-back failed: ${err.message}` });
          }
          setProgress({ done: ++done, total });
        }
        // Writes that failed don't get a read-back; keep the bar honest.
        done += d.items.length - written.length;
        setProgress({ done, total });
        s.verifying = false;
      }
      push();
    }

    const cancelled = abort.signal.aborted;
    abortRef.current = null;
    setPhase('done');
    const failed = Object.values(st).reduce((n, s) => n + s.failed + s.mismatched, 0);
    const ok = Object.values(st).reduce((n, s) => n + s.ok, 0) - Object.values(st).reduce((n, s) => n + s.mismatched, 0);
    toast(cancelled ? 'Configuration write cancelled' : failed ? `${plural(failed, 'value')} failed` : `Configuration applied to ${plural(plan.length, 'drive')}`,
      cancelled || failed ? 'error' : 'success');
    recordHistory({
      kind: 'config',
      outcome: cancelled ? 'cancelled' : failed ? (ok ? 'partial' : 'failed') : 'ok',
      title: `Configuration ${cancelled ? 'cancelled' : 'applied'} on ${plan.map((d) => jointLabel(d.pos)).join(', ')}`,
      drives: plan.map((d) => d.pos),
      stats: { writes: totalWrites, ok, failed },
      failures: plan.flatMap((d) => st[d.pos].errors.map((e) => {
        const it = d.items.find((x) => x.key === e.key);
        return {
          drive: d.pos, step: it ? d.items.indexOf(it) + 1 : undefined, name: e.name, action: /^Read-back|Drive reports/.test(e.msg) ? 'check' : 'write',
          address: it ? addrLabel(it.reg.index, it.reg.subindex) : '', value: it ? String(it.to) : '', error: e.msg,
        };
      })),
      detail: plan.map((d) => `${jointLabel(d.pos)}: ${d.items.map((it) => `${it.reg.name} ${it.from ?? '?'}→${it.to}`).join('; ')}`
        + (st[d.pos].errors.length ? `\n  errors: ${st[d.pos].errors.map((e) => `${e.name}: ${e.msg}`).join('; ')}` : '')).join('\n'),
    });
  };

  const retryFailed = () => {
    const next = plan.map((d) => {
      const bad = new Set((status[d.pos]?.errors || []).map((e) => e.key));
      return { ...d, items: d.items.filter((it) => bad.has(it.key)) };
    }).filter((d) => d.items.length);
    setPlan(next);
    setStatus({});
    setPhase('review');
  };

  const cancel = async () => {
    const ok = await confirmDialog({ title: 'Stop writing?', message: 'The value being written finishes; nothing after it is sent.', confirmText: 'Stop', cancelText: 'Keep going', tone: 'danger' });
    if (ok) abortRef.current?.abort();
  };

  const anyErrors = Object.values(status).some((s) => s.errors.length);

  return (
    <Modal open size="modal-lg" dismissable={phase !== 'running'} onClose={onClose} labelledBy="apply-title">
      <div className="modal-head">
        <div className={`modal-icon ${phase === 'done' ? (anyErrors ? 'warn' : 'ok') : 'danger'}`}>
          {phase === 'done' ? (anyErrors ? <XCircle size={18} /> : <CheckCircle2 size={18} />) : <Upload size={17} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id="apply-title">{phase === 'review' ? 'Review configuration' : phase === 'running' ? 'Writing configuration' : 'Configuration result'}</h3>
          <div className="muted small">{plural(totalWrites, 'write')} on {plural(plan.length, 'drive')}{verify ? ', verified by read-back' : ''}</div>
        </div>
      </div>

      <div className="modal-body stack">
        {phase === 'running' && <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />}
        {phase === 'review' && (
          <div className="callout callout-warn small">These values are written straight to the drives and change live parameters. Check them before writing.</div>
        )}
        <div className="apply-list">
          {plan.map((d) => {
            const s = status[d.pos];
            const state = !s ? 'pending' : s.done < d.items.length || s.verifying ? 'running' : s.errors.length ? 'error' : 'ok';
            return (
              <div key={d.pos} className={`apply-drive ${state}`}>
                <div className="apply-drive-head">
                  <span className="joint">{jointLabel(d.pos)}</span>
                  <span className="muted small">pos {d.pos} · {plural(d.items.length, 'value')}</span>
                  <span className="spacer" />
                  {state === 'running' && <span className="small muted">{s.verifying ? 'Verifying…' : `${s.done}/${d.items.length}`}</span>}
                  {state === 'running' && <span className="spinner" />}
                  {state === 'ok' && <span className="badge badge-ok">{verify ? 'Verified' : 'Written'}</span>}
                  {state === 'error' && <span className="badge badge-danger">{plural(s.errors.length, 'problem')}</span>}
                </div>
                {phase === 'review' && (
                  <table className="table table-compact">
                    <tbody>
                      {d.items.map((it) => (
                        <tr key={it.key}>
                          <td>{it.reg.name}<div className="mono muted small">{addrLabel(it.reg.index, it.reg.subindex)}</div></td>
                          <td className="num mono nowrap">
                            <span className="muted">{it.from ?? 'not read'}</span>
                            <ArrowRight size={12} style={{ margin: '0 6px', verticalAlign: -1 }} />
                            <strong>{it.to}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {s?.errors.length > 0 && (
                  <ul className="apply-errors">
                    {s.errors.map((e) => <li key={e.key}><strong>{e.name}</strong>: {e.msg}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        {phase === 'review' && (
          <label className="checkbox">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
            <ShieldCheck size={15} /> Read every value back after writing and flag any that didn't stick
          </label>
        )}
      </div>

      <div className="modal-foot">
        {phase === 'review' && (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={run} disabled={!totalWrites}><Upload size={14} /> Write {plural(totalWrites, 'value')}</button>
          </>
        )}
        {phase === 'running' && <button className="btn btn-danger" onClick={cancel}><Square size={12} fill="currentColor" /> Stop</button>}
        {phase === 'done' && (
          <>
            {anyErrors && <button className="btn" onClick={retryFailed}><RotateCcw size={14} /> Retry failed</button>}
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </Modal>
  );
}
