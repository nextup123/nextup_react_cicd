import { useState } from 'react';
import { Clock, Copy, Cpu, Lock, Pencil, Play, Trash2, Unlock } from 'lucide-react';
import { useApp, useHealth } from '../../context/AppContext';
import DriveSelector from '../../components/DriveSelector';
import { Empty } from '../../components/ui';
import { formatDate, formatDateTime, jointLabel, plural } from '../../lib/format';
import { STATUS } from './recipeModel';

/** "J1, J2, J5" or "All drives". */
export const drivesText = (drives) => (Array.isArray(drives) ? drives.map(jointLabel).join(', ') : 'All drives');
import { restartsDrive } from '../../lib/restart';
import { addrText, easyCode } from '../../lib/params';

export function StepList({ blocks }) {
  if (!blocks.length) return <Empty title="No steps yet">Edit the recipe to add steps.</Empty>;
  return (
    <div className="steps">
      {blocks.map((b, i) => (
        <div className="step" key={i}>
          <div className="step-num">{i + 1}</div>
          <div style={{ minWidth: 0 }}>
            <div className="step-name">
              <span className={`type-tag type-${b.type}`}>{b.type === 'get' ? 'Read' : 'Write'}</span>
              <span>{b.name}</span>
            </div>
            <div className="step-meta">
              {b.type === 'set'
                ? <>Set to <strong style={{ color: 'var(--text)' }}>{String(b.value)}</strong></>
                : <>Read value{b.expectedValue ? <>, should be <strong style={{ color: 'var(--text)' }}>{b.expectedValue}</strong></> : null}{b.storeAs ? <> · saved as {b.storeAs}</> : null}</>}
              {restartsDrive(b) && <span className="restart-tag" title="The run waits until the drive answers again"> · drive restarts</span>}
              <span className="step-addr" title={`Data type ${String(b.dataType).toLowerCase()}`}> · {easyCode(b.index, b.subindex) && <span className="easy mono">{easyCode(b.index, b.subindex)}</span>}{easyCode(b.index, b.subindex) ? ' · ' : ''}<span className="mono">{addrText(b.index, b.subindex)}</span></span>
            </div>
          </div>
          {i < blocks.length - 1 && b.delay > 0
            ? <span className="step-delay" title="Wait before the next step"><Clock size={12} /> wait {b.delay >= 1000 ? `${b.delay / 1000} s` : `${b.delay} ms`}</span>
            : <span />}
        </div>
      ))}
    </div>
  );
}

export default function RecipeDetail({ recipe, onEdit, onDelete, onToggleLock, onRun, onDuplicate }) {
  const { selected, slaves } = useApp();
  const health = useHealth();
  const locked = recipe.status === 'locked';
  const st = STATUS[recipe.status];
  // A recipe limited to some drives keeps its own selection (only those
  // drives can be picked; a one-drive recipe starts with that drive ticked).
  // Unlimited recipes share the app-wide selection as before.
  const allowed = Array.isArray(recipe.drives) ? new Set(recipe.drives) : null;
  const [ownPick, setOwnPick] = useState(() => {
    if (!allowed) return null;
    if (allowed.size === 1) return new Set(allowed);
    return new Set([...selected].filter((p) => allowed.has(p)));
  });
  const sel = allowed ? ownPick : selected;
  const targets = slaves.filter((s) => sel.has(s.position) && (!allowed || allowed.has(s.position))).map((s) => s.position);
  const missing = allowed ? [...allowed].filter((p) => !slaves.some((s) => s.position === p)) : [];
  const nodeDown = health.state === 'online' && !health.node?.running;
  const canRun = targets.length > 0 && recipe.blocks.length > 0;

  return (
    <div className="page">
      <div className="recipe-hero">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="row-wrap" style={{ marginBottom: 6 }}>
            <span className={`badge ${st.badge}`}>{locked && <Lock size={11} />}{st.label}</span>
            {recipe.tags.map((t) => <span key={t} className="badge">{t}</span>)}
          </div>
          <h1>{recipe.name}</h1>
          <p className={`desc ${recipe.description ? '' : 'muted'}`}>{recipe.description || 'No description.'}</p>
        </div>
        <div className="row-wrap">
          <button className="btn" onClick={onEdit}><Pencil size={14} /> Edit</button>
          <button className="btn" onClick={onDuplicate} title="Make an editable copy"><Copy size={14} /> Duplicate</button>
          <button className="btn" onClick={onToggleLock}>
            {locked ? <><Unlock size={14} /> Unlock</> : <><Lock size={14} /> Lock</>}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={onDelete} disabled={locked} title={locked ? 'Unlock to delete' : 'Delete recipe'}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="card run-card">
        <div className="card-head">
          <div>
            <div className="card-title">Run on drives</div>
            <div className="card-sub">Each step runs on every selected drive, then waits before the next step.</div>
          </div>
          <span className="badge recipe-drives" title="Set in the recipe editor"><Cpu size={12} /> {allowed ? `For ${drivesText(recipe.drives)} only` : 'For all drives'}</span>
        </div>
        <div className="card-body stack">
          {allowed ? <DriveSelector value={ownPick} onChange={setOwnPick} allowed={allowed} /> : <DriveSelector />}
          {slaves.length > 0 && missing.length > 0 && (
            <div className="muted small">Not found on the bus right now: {missing.map(jointLabel).join(', ')}.</div>
          )}
          {nodeDown && <div className="callout callout-warn small">Drive communication is off. Turn it on in the header before running.</div>}
          <div className="row-wrap">
            <button className="btn btn-success btn-lg" disabled={!canRun} onClick={() => onRun(targets)}>
              <Play size={15} fill="currentColor" />
              {targets.length ? `Run on ${targets.map(jointLabel).join(', ')}` : 'Select drives to run'}
            </button>
            {!recipe.blocks.length && <span className="muted small">This recipe has no steps.</span>}
          </div>
        </div>
      </div>

      <div className="meta-grid">
        <div><div className="k">Steps</div><div className="v">{recipe.blocks.length}</div></div>
        <div><div className="k">Drives</div><div className="v">{drivesText(recipe.drives)}</div></div>
        <div><div className="k">Runs</div><div className="v">{recipe.executionCount || 0}</div></div>
        <div><div className="k">Last run</div><div className="v">{formatDateTime(recipe.lastExecutedAt)}</div></div>
        <div><div className="k">Author</div><div className="v">{recipe.author || '—'}</div></div>
        <div><div className="k">Created</div><div className="v">{formatDate(recipe.createdAt)}</div></div>
        <div><div className="k">Modified</div><div className="v">{formatDate(recipe.modifiedAt)}</div></div>
      </div>

      {(recipe.purpose || recipe.notes) && (
        <div className="grid-2 stack-md">
          {recipe.purpose && (
            <div className="card"><div className="card-body"><div className="label" style={{ marginBottom: 4 }}>Purpose</div><p style={{ whiteSpace: 'pre-line' }}>{recipe.purpose}</p></div></div>
          )}
          {recipe.notes && (
            <div className="callout callout-warn" style={{ display: 'block' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Notes & warnings</div>
              <div style={{ whiteSpace: 'pre-line' }}>{recipe.notes}</div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="card-title">Steps</div>
          <span className="muted small">{plural(recipe.blocks.length, 'step')}</span>
        </div>
        <StepList blocks={recipe.blocks} />
      </div>
    </div>
  );
}
