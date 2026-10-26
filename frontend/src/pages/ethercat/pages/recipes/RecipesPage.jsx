import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowLeft, BookOpen, GripVertical, Plus } from 'lucide-react';
import { api } from '../../api';
import { toast } from '../../components/Toasts';
import { confirmDialog, Empty, SearchInput, Spinner } from '../../components/ui';
import { plural, uid } from '../../lib/format';
import RecipeDetail, { drivesText } from './RecipeDetail';
import RecipeEditor from './RecipeEditor';
import ExecutionModal from './ExecutionModal';
import { newRecipe, normaliseRecipe, STATUS, stripKeys, withKeys } from './recipeModel';

/** One row of the recipe list; drag it (or its grip) up or down to change the order. */
function RecipeRow({ id, canDrag, className, onClick, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !canDrag });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined };
  return (
    <button ref={setNodeRef} style={style} className={`${className} ${canDrag ? 'can-drag' : ''} ${isDragging ? 'is-dragging' : ''}`}
      onClick={onClick} {...attributes} {...(canDrag ? listeners : {})}>
      {canDrag && <span className="list-item-grip" aria-hidden="true"><GripVertical size={13} /></span>}
      {children}
    </button>
  );
}

export default function RecipesPage() {
  const [recipes, setRecipes] = useState(null); // saved state (what's on disk)
  const [loadError, setLoadError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null); // { recipe, isNew, dirty } while editing
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [run, setRun] = useState(null); // { recipe, slaves }
  const [mobileDetail, setMobileDetail] = useState(false); // phones show list or detail

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.recipes();
      const list = (data?.recipes || []).map(normaliseRecipe);
      setRecipes(list);
      setActiveId((id) => (list.some((r) => r.id === id) ? id : list[0]?.id ?? null));
    } catch (err) {
      // Don't fall back to an empty book: saving that would wipe recipe.json.
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!draft?.dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [draft?.dirty]);

  const persist = useCallback(async (nextList, successMsg) => {
    setSaving(true);
    try {
      const r = await api.saveRecipes({ recipes: nextList.map(stripKeys) });
      if (r && r.ok === false) throw new Error(r.error || 'Save failed');
      setRecipes(nextList);
      if (successMsg) toast(successMsg, 'success');
      return true;
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'error', 6000);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /** Resolve unsaved edits before navigating away. Returns false to abort. */
  const leaveDraft = useCallback(async () => {
    if (!draft) return true;
    if (!draft.dirty) { setDraft(null); return true; }
    const discard = await confirmDialog({
      title: 'Discard unsaved changes?',
      message: `Your edits to "${draft.recipe.name}" haven't been saved.`,
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      tone: 'danger',
    });
    if (discard) setDraft(null);
    return discard;
  }, [draft]);

  const select = async (id) => {
    if (id === activeId) { setMobileDetail(true); return; }
    if (draft && !(await leaveDraft())) return;
    setActiveId(id);
    setMobileDetail(true);
  };

  const duplicate = async (recipe) => {
    if (draft && !(await leaveDraft())) return;
    const now = new Date().toISOString();
    const copy = normaliseRecipe({
      ...stripKeys(recipe), id: uid('recipe'), name: `${recipe.name} (copy)`, status: recipe.blocks.length ? 'ready' : 'draft',
      executionCount: 0, lastExecutedAt: null, createdAt: now, modifiedAt: now,
    });
    setDraft({ recipe: withKeys(copy), isNew: true, dirty: true });
    setActiveId(copy.id);
    setMobileDetail(true);
  };

  const create = async () => {
    if (draft && !(await leaveDraft())) return;
    const r = newRecipe(recipes?.length || 0);
    setDraft({ recipe: withKeys(r), isNew: true, dirty: true });
    setActiveId(r.id);
    setMobileDetail(true);
  };

  const startEdit = async (recipe) => {
    if (recipe.status === 'locked') {
      const ok = await confirmDialog({
        title: 'Recipe is locked',
        message: `"${recipe.name}" is locked to prevent accidental changes. Unlock it and start editing?\n\nIt stays locked if you cancel.`,
        confirmText: 'Unlock & edit',
        tone: 'warn',
      });
      if (!ok) return;
      setDraft({ recipe: withKeys({ ...recipe, status: recipe.blocks.length ? 'ready' : 'draft' }), isNew: false, dirty: true });
      return;
    }
    setDraft({ recipe: withKeys(recipe), isNew: false, dirty: false });
  };

  const saveDraft = async () => {
    const r = stripKeys({ ...draft.recipe, name: draft.recipe.name.trim(), modifiedAt: new Date().toISOString() });
    const next = draft.isNew ? [...recipes, r] : recipes.map((x) => (x.id === r.id ? r : x));
    if (await persist(next, `"${r.name}" saved`)) setDraft(null);
  };

  const cancelDraft = async () => {
    if (draft.dirty) {
      const ok = await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved changes will be lost.', confirmText: 'Discard', cancelText: 'Keep editing', tone: 'danger' });
      if (!ok) return;
    }
    if (draft.isNew) setActiveId(recipes[0]?.id ?? null);
    setDraft(null);
  };

  const remove = async (recipe) => {
    if (recipe.status === 'locked') { toast('Unlock the recipe before deleting it', 'warn'); return; }
    const ok = await confirmDialog({
      title: 'Delete recipe?',
      message: `"${recipe.name}" and its ${plural(recipe.blocks.length, 'step')} will be permanently removed.`,
      confirmText: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const idx = recipes.findIndex((r) => r.id === recipe.id);
    const next = recipes.filter((r) => r.id !== recipe.id);
    // The old UI only removed it from memory; it came back after a reload.
    if (await persist(next, 'Recipe deleted')) setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? null);
  };

  const toggleLock = async (recipe) => {
    const locking = recipe.status !== 'locked';
    const ok = await confirmDialog({
      title: locking ? 'Lock recipe?' : 'Unlock recipe?',
      message: locking
        ? `Locked recipes can't be edited or deleted until unlocked. They can still be run.`
        : `"${recipe.name}" will be editable again.`,
      confirmText: locking ? 'Lock' : 'Unlock',
    });
    if (!ok) return;
    const updated = { ...recipe, status: locking ? 'locked' : (recipe.blocks.length ? 'ready' : 'draft'), modifiedAt: new Date().toISOString() };
    await persist(recipes.map((r) => (r.id === recipe.id ? updated : r)), locking ? 'Recipe locked' : 'Recipe unlocked');
  };

  // Order of the list = order in recipe.json. Saved as soon as a recipe is dropped.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = recipes.findIndex((r) => r.id === active.id);
    const to = recipes.findIndex((r) => r.id === over.id);
    if (from < 0 || to < 0) return;
    const before = recipes;
    const next = arrayMove(recipes, from, to);
    setRecipes(next); // move it now, not after the save
    if (!(await persist(next))) setRecipes(before);
  };

  const onExecuted = (id, info) => {
    setRecipes((list) => list.map((r) => (r.id === id ? { ...r, executionCount: info.executionCount, lastExecutedAt: info.lastExecutedAt } : r)));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!recipes) return [];
    const list = draft?.isNew ? [...recipes, draft.recipe] : recipes;
    if (!q) return list;
    return list.filter((r) => r.name.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)) || r.description.toLowerCase().includes(q));
  }, [recipes, draft, query]);

  if (loadError) {
    return (
      <div className="split-main" style={{ width: '100%' }}>
        <div className="callout callout-danger" style={{ maxWidth: 640 }}>
          <AlertTriangle size={16} />
          <div className="stack" style={{ gap: 8 }}>
            <div><strong>Recipes could not be loaded.</strong> {loadError}</div>
            <div>Nothing has been overwritten. Fix data/recipe.json (a backup of the last save is in recipe.json.bak) and retry.</div>
            <div><button className="btn btn-sm" onClick={load}>Retry</button></div>
          </div>
        </div>
      </div>
    );
  }

  if (!recipes) return <div className="empty" style={{ width: '100%' }}><Spinner large /></div>;

  const active = draft && draft.recipe.id === activeId ? null : recipes.find((r) => r.id === activeId);

  return (
    <div className={`split ${mobileDetail ? 'show-detail' : ''}`}>
      <aside className="split-list">
        <div className="split-list-head">
          <div className="row">
            <strong>Recipes</strong>
            <span className="muted small">{recipes.length}</span>
            <div className="spacer" />
            <button className="btn btn-primary btn-sm" onClick={create}><Plus size={14} /> New</button>
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Search name or tag" />
        </div>
        <div className="split-list-body">
          {filtered.length === 0 && <div className="empty small">{query ? 'No matching recipes' : 'No recipes yet'}</div>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={filtered.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {filtered.map((r) => {
            const isDraft = draft?.recipe.id === r.id;
            const rec = isDraft ? draft.recipe : r;
            const canDrag = !query.trim() && !(isDraft && draft.isNew) && !saving;
            return (
              <RecipeRow key={r.id} id={r.id} canDrag={canDrag} className={`list-item ${r.id === activeId ? 'active' : ''}`} onClick={() => select(r.id)}>
                <div className="list-item-title">
                  <span>{rec.name || 'Untitled'}</span>
                  {isDraft && draft.dirty && <span className="badge badge-warn" style={{ height: 18 }}>unsaved</span>}
                </div>
                <div className="list-item-meta">
                  <span>{plural(rec.blocks.length, 'step')}</span>
                  {Array.isArray(rec.drives) && <span title="Drives this recipe can run on">{drivesText(rec.drives)}</span>}
                  {rec.executionCount > 0 && <span>{plural(rec.executionCount, 'run')}</span>}
                  <span className="spacer" />
                  <span className={`badge ${STATUS[rec.status].badge}`} style={{ height: 18, fontSize: 10.5 }}>{STATUS[rec.status].label}</span>
                </div>
              </RecipeRow>
            );
          })}
          </SortableContext>
          </DndContext>
          {recipes.length > 1 && !query.trim() && <div className="list-hint muted small">Drag a recipe up or down to change the order.</div>}
        </div>
      </aside>

      <section className="split-main">
        <button className="btn btn-ghost btn-sm back-btn" onClick={() => setMobileDetail(false)}><ArrowLeft size={15} /> All recipes</button>
        {draft && draft.recipe.id === activeId ? (
          <RecipeEditor
            draft={draft}
            onChange={(recipe) => setDraft((d) => ({ ...d, recipe, dirty: true }))}
            onSave={saveDraft}
            onCancel={cancelDraft}
            saving={saving}
          />
        ) : active ? (
          <RecipeDetail
            key={`${active.id}:${(active.drives || []).join(',')}`}
            recipe={active}
            onEdit={() => startEdit(active)}
            onDelete={() => remove(active)}
            onToggleLock={() => toggleLock(active)}
            onDuplicate={() => duplicate(active)}
            onRun={(slaves) => setRun({ recipe: active, slaves })}
          />
        ) : (
          <Empty icon={BookOpen} title="No recipe selected">Pick a recipe on the left, or create one to save a set of steps you can run on several drives.</Empty>
        )}
      </section>

      {run && (
        <ExecutionModal
          recipe={run.recipe}
          slaves={run.slaves}
          onClose={() => setRun(null)}
          onExecuted={onExecuted}
        />
      )}
    </div>
  );
}
