import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, GripVertical, Save, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SearchSelect } from '../../components/ui';
import { jointLabel, normDtype, uid, validateValue } from '../../lib/format';
import { blockFromPreset, validateRecipe } from './recipeModel';
import { restartsDrive } from '../../lib/restart';
import { addrText, easyCode, matchParam, ParamOption, useParamList } from '../../lib/params';

function BlockCard({ block, index, count, onChange, onMove, onDuplicate, onDelete, drag }) {
  const set = (patch) => onChange({ ...block, ...patch });
  const isString = normDtype(block.dataType) === 'string';
  const valueError = block.type === 'set' ? validateValue(block.value, block.dataType) : null;

  return (
    <div className={`block-card ${drag.className}`} {...drag.targetProps}>
      <div className="block-card-head">
        <span className="drag-handle" {...drag.handleProps} title="Drag to reorder"><GripVertical size={16} /></span>
        <span className="step-num">{index + 1}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.name}</div>
          <div className="step-meta">{easyCode(block.index, block.subindex) && <><span className="easy mono">{easyCode(block.index, block.subindex)}</span> · </>}<span className="mono">{addrText(block.index, block.subindex)}</span> · {normDtype(block.dataType)}</div>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" disabled={index === 0} onClick={() => onMove(index - 1)} title="Move up"><ArrowUp size={14} /></button>
        <button className="btn btn-ghost btn-icon btn-sm" disabled={index === count - 1} onClick={() => onMove(index + 1)} title="Move down"><ArrowDown size={14} /></button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onDuplicate} title="Duplicate"><Copy size={14} /></button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onDelete} title="Remove step"><Trash2 size={14} /></button>
      </div>
      <div className="block-card-body">
        <div className="field">
          <label>Operation</label>
          <div className="seg">
            <button type="button" className={block.type === 'set' ? 'on' : ''} onClick={() => set({ type: 'set' })}>Write</button>
            <button type="button" className={block.type === 'get' ? 'on' : ''} onClick={() => set({ type: 'get' })}>Read</button>
          </div>
        </div>
        {block.type === 'set' ? (
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Value to write</label>
            <input className={`input mono ${valueError ? 'invalid' : ''}`} value={String(block.value ?? '')}
              inputMode={isString ? 'text' : 'decimal'}
              onChange={(e) => {
                const raw = e.target.value;
                // Keep numbers as numbers in recipe.json (as before); strings stay strings.
                const canonical = !isString && raw.trim() !== '' && String(Number(raw)) === raw.trim();
                set({ value: canonical ? Number(raw) : raw });
              }} />
            {valueError && <span className="field-error">{valueError}</span>}
          </div>
        ) : (
          <>
            <div className="field">
              <label>Expected <span className="hint">optional</span></label>
              <input className="input mono" value={block.expectedValue} placeholder="5 · 1-5 · 1,2,3"
                onChange={(e) => set({ expectedValue: e.target.value })} />
            </div>
            <div className="field">
              <label>Store as <span className="hint">optional</span></label>
              <input className="input" value={block.storeAs} placeholder="variable name"
                onChange={(e) => set({ storeAs: e.target.value })} />
            </div>
          </>
        )}
        <div className="field">
          <label>Wait after <span className="hint">ms</span></label>
          <input className="input mono" type="number" min="0" step="100" value={block.delay}
            onChange={(e) => set({ delay: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
        {block.type === 'set' && (
          <label className="checkbox small" style={{ gridColumn: '1 / -1' }} title="The drive cannot confirm a write that restarts it. The run waits until it answers again, up to 30 s.">
            <input type="checkbox" checked={!!restartsDrive(block)} onChange={(e) => set({ restarts: e.target.checked })} />
            The drive restarts after this step (wait until it answers again)
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Which drives the recipe may run on. "All drives" stores no list; otherwise
 * the run screen only offers the drives ticked here.
 */
function DrivesField({ drives, onChange }) {
  const { slaves } = useApp();
  const limited = Array.isArray(drives);
  const found = slaves.map((s) => s.position);
  const positions = [...new Set([...(found.length ? found : [0, 1, 2, 3, 4, 5]), ...(drives || [])])].sort((a, b) => a - b);
  const toggle = (pos) => {
    const next = new Set(drives || []);
    if (next.has(pos)) next.delete(pos); else next.add(pos);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div className="field">
      <label>Drives this recipe can run on</label>
      <div className="row-wrap">
        <div className="seg">
          <button type="button" className={limited ? '' : 'on'} onClick={() => onChange(null)}>All drives</button>
          <button type="button" className={limited ? 'on' : ''} onClick={() => onChange(limited ? drives : [])}>Only some drives</button>
        </div>
        {limited && (
          <div className="drive-chips">
            {positions.map((pos) => {
              const on = drives.includes(pos);
              return (
                <button key={pos} type="button" className={`drive-chip ${on ? 'selected' : ''}`} onClick={() => toggle(pos)}
                  title={found.length && !found.includes(pos) ? 'Not found on the bus right now' : undefined}>
                  <span className="chk">{on && <Check size={11} strokeWidth={3} />}</span>
                  {jointLabel(pos)}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <span className="hint small">
        {!limited ? 'Can be run on any drive or group of drives.'
          : drives.length === 0 ? 'Tick at least one drive.'
            : drives.length === 1 ? `Can only be run on ${jointLabel(drives[0])}.`
              : `Can be run on any group of ${drives.map(jointLabel).join(', ')}.`}
      </span>
    </div>
  );
}

export default function RecipeEditor({ draft, onChange, onSave, onCancel, saving }) {
  const r = draft.recipe;
  const presets = useParamList();
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const problems = validateRecipe(r);

  const set = (patch) => onChange({ ...r, ...patch });
  const setBlocks = (blocks) => {
    const status = r.status === 'draft' && blocks.length > 0 && r.blocks.length === 0 ? 'ready' : r.status;
    set({ blocks, status });
  };
  const updateBlock = (i, b) => setBlocks(r.blocks.map((x, j) => (j === i ? b : x)));
  const move = (from, to) => {
    if (to < 0 || to >= r.blocks.length || from === to) return;
    const next = [...r.blocks];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setBlocks(next);
  };

  const dragFor = (i) => ({
    className: `${dragFrom === i ? 'dragging' : ''} ${dragOver === i && dragFrom !== i ? 'drag-over' : ''}`,
    handleProps: {
      draggable: true,
      onDragStart: (e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; },
      onDragEnd: () => { setDragFrom(null); setDragOver(null); },
    },
    targetProps: {
      onDragOver: (e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } },
      onDrop: (e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); setDragOver(null); },
    },
  });

  // Ctrl/⌘+S saves while editing (the old shortcut also fired outside edit mode).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!problems.length && !saving) onSave();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="page">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18 }}>{draft.isNew ? 'New recipe' : 'Edit recipe'}</h2>
          <div className="muted small">Changes apply only after you save.</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={onSave} disabled={saving || problems.length > 0}
          title={problems.length ? problems.join('\n') : 'Save (Ctrl+S)'}>
          {saving ? <span className="spinner" /> : <Save size={14} />} Save recipe
        </button>
      </div>

      <div className="card">
        <div className="card-body stack">
          <div className="grid-3">
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label>Name</label>
              <input className={`input ${r.name.trim() ? '' : 'invalid'}`} value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder="Recipe name" />
            </div>
            <div className="field">
              <label>Status</label>
              <select className="select input" value={r.status === 'locked' ? 'ready' : r.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
              </select>
            </div>
          </div>
          <DrivesField drives={r.drives} onChange={(drives) => set({ drives })} />
          <div className="field">
            <label>Description</label>
            <textarea className="textarea" rows={2} value={r.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this recipe does" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Purpose & context</label>
              <textarea className="textarea" rows={3} value={r.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="When should it be used?" />
            </div>
            <div className="field">
              <label>Notes & warnings</label>
              <textarea className="textarea" rows={3} value={r.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Precautions for operators" />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Author</label>
              <input className="input" value={r.author} onChange={(e) => set({ author: e.target.value })} />
            </div>
            <div className="field">
              <label>Tags <span className="hint">comma separated</span></label>
              <input className="input" defaultValue={r.tags.join(', ')} placeholder="homing, init"
                onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="card-title">Steps</div>
          <span className="muted small">{r.blocks.length}</span>
          <div style={{ flex: 1, minWidth: 260, maxWidth: 420, marginLeft: 'auto' }}>
            <SearchSelect
              items={presets}
              placeholder="Add a step: search by name or H-code (e.g. H0D.00)"
              filter={matchParam}
              render={(p) => <ParamOption p={p} />}
              onPick={(p) => setBlocks([...r.blocks, blockFromPreset(p)])}
            />
          </div>
        </div>
        <div className="card-body stack" style={{ gap: 8 }}>
          {r.blocks.length === 0 && <div className="empty small">No steps yet. Search above to add one.</div>}
          {r.blocks.map((b, i) => (
            <BlockCard key={b._key} block={b} index={i} count={r.blocks.length}
              onChange={(nb) => updateBlock(i, nb)}
              onMove={(to) => move(i, to)}
              onDuplicate={() => { const next = [...r.blocks]; next.splice(i + 1, 0, { ...b, _key: uid('b') }); setBlocks(next); }}
              onDelete={() => setBlocks(r.blocks.filter((_, j) => j !== i))}
              drag={dragFor(i)} />
          ))}
        </div>
      </div>

      {problems.length > 0 && (
        <div className="callout callout-warn small">
          <div>{problems.map((p) => <div key={p}>{p}</div>)}</div>
        </div>
      )}
    </div>
  );
}
