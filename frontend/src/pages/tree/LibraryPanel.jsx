// Left-hand panel (hidden until opened from the toolbar): subtrees of this
// project, motion programs (added as <RunProgram> nodes), DO/DI subtrees that
// can be inserted, and the editable
// quick-add list. Each section folds; the folded state is remembered.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  CornerDownRight,
  Eye,
  ExternalLink,
  FolderTree,
  Keyboard,
  PanelLeftClose,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Sparkles,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { Alert, Badge, Button, Card, IconButton, Input, Kbd, Select, Spinner, cx } from "../../components/ui";
import { quickAdd, useQuickAdd } from "./shortcuts";
import { colorOf } from "./treeModel";

const FOLD_KEY = "nextup.tree.libFolded";
function useFolded() {
  const [folded, setFolded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY)) || {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(folded));
    } catch {
      /* storage unavailable */
    }
  }, [folded]);
  return [folded, (k) => setFolded((f) => ({ ...f, [k]: !f[k] }))];
}

function Section({ id, folded, onFold, icon: Icon, title, count, extra, children }) {
  const closed = !!folded[id];
  return (
    <section className={cx("bt-lib-section", closed && "is-folded")} data-tut={`bt-lib-${id}`}>
      <div className="bt-lib-head">
        <button type="button" className="bt-lib-fold" onClick={() => onFold(id)} aria-expanded={!closed}>
          {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="section-label">
            {Icon && <Icon size={12} />} {title}
          </span>
          {count != null && <span className="bt-lib-count">{count}</span>}
        </button>
        {!closed && extra}
      </div>
      {!closed && children}
    </section>
  );
}

export default function LibraryPanel({
  subtrees,
  programs,
  doDis,
  currentId,
  insertReason,
  onOpen,
  onPreview,
  onInsert,
  onInsertProgram,
  programReason,
  onDelete,
  onCreate,
  onReload,
  reloading,
  onXml,
  lib,
  quickReason,
  onQuickAdd,
  onShowShortcuts,
  onNewType,
  onHide,
}) {
  const [folded, fold] = useFolded();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const list = subtrees.data || [];
  const others = list.filter((s) => s !== "main_tree");
  const hasMain = list.includes("main_tree");

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    const ok = await onCreate(name.trim());
    setCreating(false);
    if (ok) setName("");
  };

  const insertTitle = (what) => insertReason || `Insert into the selected node (${what})`;

  return (
    <Card
      title="Library"
      tut="bt-library"
      icon={FolderTree}
      className="bt-library"
      bodyClassName="bt-library-body"
      flush
      actions={
        <>
          <IconButton icon={Sparkles} label="Create a custom node type for the library" size="sm" onClick={onNewType} />
          <IconButton icon={RefreshCw} label="Reload all lists" size="sm" onClick={onReload} disabled={reloading} />
          <IconButton icon={PanelLeftClose} label="Hide the library" size="sm" onClick={onHide} />
        </>
      }
    >
      {/* Subtrees */}
      <Section
        id="subtrees"
        folded={folded}
        onFold={fold}
        title="Subtrees"
        count={list.length || null}
        extra={
          <Button size="sm" variant="ghost" icon={Code2} onClick={() => onXml("mainTree")} title="Show the generated source of all subtrees">
            Source
          </Button>
        }
      >
        <form className="bt-lib-create" onSubmit={create} data-tut="bt-lib-create">
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="New subtree name" aria-label="New subtree name" />
          <Button size="sm" type="submit" variant="primary" icon={Plus} loading={creating} disabled={!name.trim()} title={name.trim() ? "Create subtree" : "Type a name first"}>
            Add
          </Button>
        </form>
        <ListState q={subtrees} empty="No subtrees yet">
          <div className="bt-lib-list is-scroll">
            {hasMain && (
              <LibItem
                name="main_tree"
                icon={Star}
                badge={<Badge tone="primary">Main</Badge>}
                active={currentId === "main_tree"}
                onOpen={() => onOpen("main_tree")}
                onPreview={() => onPreview("template", "main_tree")}
              />
            )}
            {others.map((id) => (
              <LibItem
                key={id}
                name={id}
                active={currentId === id}
                onOpen={() => onOpen(id)}
                onPreview={() => onPreview("template", id)}
                onInsert={() => onInsert("template", id)}
                insertDisabled={!!insertReason || id === currentId}
                insertTitle={id === currentId ? "A subtree cannot be inserted into itself" : insertTitle("full copy or link")}
                onDelete={() => onDelete(id)}
              />
            ))}
          </div>
        </ListState>
      </Section>

      {/* Motion programs: each one is added as a <RunProgram program="…"/> node */}
      <ProgramsSection folded={folded} onFold={fold} programs={programs} insertReason={programReason} onInsertProgram={onInsertProgram} />

      {/* DO/DI subtrees */}
      <Section
        id="doDi"
        folded={folded}
        onFold={fold}
        icon={Plug}
        title="DO/DI subtrees"
        count={doDis.data?.length || null}
        extra={
          <Button size="sm" variant="ghost" icon={Code2} onClick={() => onXml("doDiTree")} title="Show the source of the DO/DI subtrees">
            Source
          </Button>
        }
      >
        <ListState q={doDis} empty="No DO/DI subtrees. Create them on the IO Control page.">
          <div className="bt-lib-list is-scroll">
            {(doDis.data || []).map((id) => (
              <LibItem
                key={id}
                name={id}
                onPreview={() => onPreview("doDi", id)}
                onInsert={() => onInsert("doDi", id)}
                insertDisabled={!!insertReason}
                insertTitle={insertTitle("full copy or link")}
              />
            ))}
          </div>
        </ListState>
      </Section>

      <QuickAddSection folded={folded} onFold={fold} lib={lib} quickReason={quickReason} onQuickAdd={onQuickAdd} onShowShortcuts={onShowShortcuts} />
    </Card>
  );
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const prettify = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

function QuickAddSection({ folded, onFold, lib, quickReason, onQuickAdd, onShowShortcuts }) {
  const items = useQuickAdd((s) => s.items);
  const [editing, setEditing] = useState(false);
  const [newType, setNewType] = useState("");
  const [newKey, setNewKey] = useState("");
  const usedKeys = useMemo(() => new Map(items.filter((i) => i.key).map((i) => [i.key, i.nodeName])), [items]);
  const freeKey = (name) => LETTERS.find((l) => l === name[0]?.toLowerCase() && !usedKeys.has(l)) || "";

  const keyOptions = (current) => [
    { value: "", label: "No key" },
    ...LETTERS.map((l) => ({ value: l, label: usedKeys.has(l) && l !== current ? `${l.toUpperCase()} (${usedKeys.get(l)})` : l.toUpperCase() })),
  ];

  const add = (e) => {
    e.preventDefault();
    if (!newType) return;
    quickAdd.add({ nodeName: newType, label: prettify(newType), key: newKey });
    setNewType("");
    setNewKey("");
  };

  return (
    <Section
      id="quick"
      folded={folded}
      onFold={onFold}
      icon={Zap}
      title="Quick add"
      count={items.length || null}
      extra={
        <div className="row" style={{ gap: 2 }}>
          {!editing && <IconButton data-tut="bt-keys-btn" icon={Keyboard} size="sm" label="All keyboard shortcuts (Ctrl+S)" onClick={onShowShortcuts} />}
          <Button data-tut="bt-qa-edit" size="sm" variant={editing ? "primary" : "ghost"} icon={editing ? Check : Pencil} onClick={() => setEditing((v) => !v)} title={editing ? "Done editing" : "Add, remove or re-key entries"}>
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      }
    >
      <div className="bt-lib-list">
        {items.length === 0 && <div className="bt-lib-note">No quick-add entries. Click Edit to add some.</div>}
        {items.map((s, i) => {
          const known = !!lib?.byName.get(s.nodeName);
          const childReason = !known ? `"${s.nodeName}" is not in the node library` : quickReason.child;
          const afterReason = !known ? `"${s.nodeName}" is not in the node library` : quickReason.after;
          const K = s.key.toUpperCase();
          return (
            <div key={`${s.nodeName}:${i}`} className={cx("bt-lib-item", "is-static", !known && "is-muted")}>
              <span className="bt-qa-dot" style={{ background: colorOf(s.nodeName, lib) }} />
              <span className="grow truncate" title={s.nodeName}>
                {s.label}
              </span>
              {editing ? (
                <>
                  <Select size="sm" className="bt-qa-key" value={s.key} onChange={(e) => quickAdd.setKey(i, e.target.value)} options={keyOptions(s.key)} aria-label={`Key for ${s.label}`} />
                  <IconButton icon={ArrowUp} size="sm" label="Move up" className="bt-qa-move" disabled={i === 0} onClick={() => quickAdd.move(i, -1)} />
                  <IconButton icon={Trash2} size="sm" variant="ghost-danger" label={`Remove ${s.label}`} onClick={() => quickAdd.remove(i)} />
                </>
              ) : (
                <>
                  {s.key && (
                    <span className="bt-keys" title={`Shift+${K} adds inside, Alt+${K} adds after`}>
                      <Kbd>{K}</Kbd>
                    </span>
                  )}
                  <IconButton
                    data-tut={`qa-child-${s.nodeName}`}
                    icon={CornerDownRight}
                    size="sm"
                    label={childReason || `Add inside selected${s.key ? ` (Shift+${K})` : ""}`}
                    disabled={!!childReason}
                    onClick={() => onQuickAdd("child", s.nodeName)}
                  />
                  <IconButton
                    data-tut={`qa-after-${s.nodeName}`}
                    icon={ArrowRight}
                    size="sm"
                    label={afterReason || `Add after selected${s.key ? ` (Alt+${K})` : ""}`}
                    disabled={!!afterReason}
                    onClick={() => onQuickAdd("after", s.nodeName)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
      {editing && (
        <form className="bt-qa-add" onSubmit={add}>
          <Select
            size="sm"
            value={newType}
            placeholder="Node type…"
            onChange={(e) => {
              setNewType(e.target.value);
              setNewKey(freeKey(e.target.value));
            }}
            aria-label="Node type to add"
          >
            {(lib?.categories || []).map((c) => (
              <optgroup key={c.key} label={c.label}>
                {c.nodes.map((n) => (
                  <option key={`${n.group}:${n.name}`} value={n.name}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Select size="sm" className="bt-qa-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} options={keyOptions("")} aria-label="Key" />
          <Button size="sm" type="submit" variant="primary" icon={Plus} disabled={!newType} title={newType ? "Add to quick add" : "Choose a node type"}>
            Add
          </Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={quickAdd.reset} title="Back to the default list" className="bt-qa-reset">
            Reset to default
          </Button>
          <div className="xs muted bt-qa-help">Shift + key adds inside the selected node, Alt + key adds after it. A key can belong to one entry only.</div>
        </form>
      )}
    </Section>
  );
}

function ProgramsSection({ folded, onFold, programs, insertReason, onInsertProgram }) {
  const navigate = useNavigate();
  const list = programs.data?.programs || [];
  const problems = useMemo(() => {
    const m = new Map();
    for (const pr of programs.data?.problems || []) if (pr.level === "error") m.set(pr.program, (m.get(pr.program) || 0) + 1);
    return m;
  }, [programs.data]);
  const q = { ...programs, data: list };
  return (
    <Section
      id="programs"
      folded={folded}
      onFold={onFold}
      icon={Route}
      title="Motion programs"
      count={list.length || null}
      extra={
        <IconButton icon={ExternalLink} size="sm" label="Open the Motion Programs page to create or change programs" onClick={() => navigate("/programs")} />
      }
    >
      <ListState q={q} empty={programs.data?.parseError ? "The motion programs could not be read. Fix them on the Motion Programs page." : "No motion programs yet. Create them on the Motion Programs page."}>
        <div className="bt-lib-list is-scroll">
          {list.map((p) => {
            const errs = problems.get(p.name) || 0;
            const steps = Array.isArray(p.steps) ? p.steps.length : null;
            const info = [p.description, steps != null ? `${steps} step${steps === 1 ? "" : "s"}` : "", errs ? `${errs} problem${errs === 1 ? "" : "s"} to fix` : ""].filter(Boolean).join(" · ");
            return (
              <div key={p.name} className="bt-lib-item is-static" title={info || p.name}>
                <span className="bt-lib-name is-static">
                  <span className="truncate">{p.name}</span>
                  {errs > 0 && <Badge tone="danger">{errs}</Badge>}
                </span>
                <IconButton
                  icon={Plus}
                  size="sm"
                  label={insertReason || `Add a RunProgram node for "${p.name}" to the selected node`}
                  disabled={!!insertReason}
                  onClick={() => onInsertProgram(p.name)}
                />
              </div>
            );
          })}
        </div>
      </ListState>
    </Section>
  );
}

function ListState({ q, empty, children }) {
  if (q.isLoading)
    return (
      <div className="bt-lib-note">
        <Spinner /> Loading…
      </div>
    );
  if (q.isError)
    return (
      <Alert tone="danger" className="bt-lib-alert" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>
        {q.error?.message || "Could not load the list"}
      </Alert>
    );
  if (!q.data?.length) return <div className="bt-lib-note">{empty}</div>;
  return children;
}

function LibItem({ name, icon: Icon, badge, active, onOpen, onPreview, onInsert, insertDisabled, insertTitle, onDelete }) {
  return (
    <div className={cx("bt-lib-item", active && "is-active", !onOpen && "is-static")} data-tut-subtree={name}>
      {onOpen ? (
        <button type="button" className="bt-lib-name" onClick={onOpen} title={active ? "Open in the editor" : `Open "${name}" in the editor`}>
          {Icon && <Icon size={14} />}
          <span className="truncate">{name}</span>
          {badge}
        </button>
      ) : (
        <span className="bt-lib-name is-static truncate" title={name}>
          {name}
        </span>
      )}
      {onInsert && <IconButton data-tut="bt-lib-insert" icon={Plus} size="sm" label={insertTitle} disabled={insertDisabled} onClick={onInsert} />}
      <IconButton icon={Eye} size="sm" label="Preview" onClick={onPreview} />
      {onDelete && <IconButton icon={Trash2} size="sm" variant="ghost-danger" label={`Delete subtree "${name}"`} onClick={onDelete} />}
    </div>
  );
}
