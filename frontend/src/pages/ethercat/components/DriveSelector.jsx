import { Check, Lock, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { jointLabel, stateLabel, stateTone } from '../lib/format';

/**
 * Chip row for picking target drives. Uses the app-wide selection unless
 * `value` / `onChange` are passed (then it's controlled locally).
 * `allowed` (a Set of positions) greys out every other drive.
 */
export default function DriveSelector({ value, onChange, disabled, showScan = true, compact, allowed }) {
  const { slaves, selected, setSelected, scan, scanning } = useApp();
  const sel = value ?? selected;
  const set = onChange ?? setSelected;

  const toggle = (pos) => {
    const next = new Set(sel);
    if (next.has(pos)) next.delete(pos); else next.add(pos);
    set(next);
  };

  if (!slaves.length) {
    return (
      <div className="row muted small">
        No drives scanned yet.
        {showScan && (
          <button className="btn btn-sm" onClick={() => scan()} disabled={scanning}>
            <RefreshCw size={13} className={scanning ? 'spin' : ''} /> Find drives
          </button>
        )}
      </div>
    );
  }

  const ok = (pos) => !allowed || allowed.has(pos);
  const usable = slaves.filter((s) => ok(s.position));
  const allOn = usable.length > 0 && usable.every((s) => sel.has(s.position));
  return (
    <div className="row-wrap">
      <div className="drive-chips">
        {slaves.map((s) => {
          const can = ok(s.position);
          const on = can && sel.has(s.position);
          const tone = stateTone(s.state);
          return (
            <button key={s.position} type="button" className={`drive-chip ${on ? 'selected' : ''} ${can ? '' : 'not-allowed'}`}
              onClick={() => toggle(s.position)} disabled={disabled || !can}
              title={can ? `${s.name} · ${stateLabel(s.state)} (${s.state})` : 'This recipe is not set up for this drive'}>
              <span className="chk">{on ? <Check size={11} strokeWidth={3} /> : !can ? <Lock size={10} /> : null}</span>
              <span className={`sdot ${tone}`} />
              {jointLabel(s.position)}
              {!compact && tone !== 'ok' && <span className={`state ${tone === 'ok' ? '' : 'warn'}`}>{stateLabel(s.state)}</span>}
            </button>
          );
        })}
      </div>
      <button className="btn btn-ghost btn-sm" disabled={disabled || !usable.length}
        onClick={() => set(allOn ? new Set() : new Set(usable.map((s) => s.position)))}>
        {allOn ? 'Clear' : 'All'}
      </button>
    </div>
  );
}
