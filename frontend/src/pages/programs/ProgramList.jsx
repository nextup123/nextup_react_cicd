// Left column: the programs of programs.yaml, search, "New" from templates.
import { useMemo, useState } from "react";
import { CircleAlert, Copy, FilePlus2, MoreVertical, Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button, EmptyState, Menu, SearchInput, cx } from "../../components/ui";
import { TEMPLATES } from "./programTemplates";
import { Tip } from "./Tip";

export default function ProgramList({ data, current, dirty, runningName, onOpen, onNew, onDuplicate, onRename, onDelete, onCreateFile }) {
  const [q, setQ] = useState("");
  const programs = data?.programs || [];
  const byName = useMemo(() => {
    const m = new Map();
    for (const pr of data?.problems || []) {
      const e = m.get(pr.program) || { error: 0, warning: 0, first: "" };
      e[pr.level] += 1;
      if (!e.first && pr.level === "error") e.first = pr.message;
      m.set(pr.program, e);
    }
    return m;
  }, [data]);
  const shown = programs.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase()));
  const newMenu = (
    <Menu
      align="left"
      floating
      trigger={({ toggle }) => (
        <Button size="sm" variant="primary" icon={Plus} onClick={toggle} data-tut="mp-new">
          New
        </Button>
      )}
      items={[{ header: "Start from" }, ...TEMPLATES.map((t) => ({ label: t.label, hint: `${t.program.steps.length} steps`, title: t.use, tut: `mp-tpl-${t.id}`, onClick: () => onNew(t) }))]}
    />
  );

  return (
    <div className="mp-list card" data-tut="mp-list">
      <div className="mp-list-head">
        <span className="card-title grow">Programs</span>
        {data?.exists !== false && newMenu}
      </div>
      {programs.length > 4 && (
        <div className="mp-list-search" data-tut="mp-search">
          <SearchInput size="sm" value={q} onChange={setQ} placeholder="Search programs…" />
        </div>
      )}
      <div className="mp-list-body">
        {data?.parseError ? (
          <div className="mp-note is-danger">{data.parseError}. Fix it in the Text tab (Whole file).</div>
        ) : data?.exists === false ? (
          <EmptyState
            icon={FilePlus2}
            title="No motion programs yet"
            text="This project was made before motion programs existed. Start them with a simple starter program."
            action={
              <Button variant="primary" size="sm" icon={FilePlus2} onClick={onCreateFile}>
                Start motion programs
              </Button>
            }
            compact
          />
        ) : !programs.length ? (
          <EmptyState title="No programs" text="Start from a template: pick and place, welding, palletizing …" action={newMenu} compact />
        ) : (
          <ul className="mp-plist-items">
            {shown.map((p) => {
              const pr = byName.get(p.name);
              const isCur = current === p.name;
              return (
                <li key={p.name} data-tut="mp-prog" data-tut-program={p.name} className={cx("mp-prog", isCur && "is-cur")} onClick={() => !isCur && onOpen(p)}>
                  <div className="mp-prog-main">
                    <div className="mp-prog-name">
                      {runningName === p.name && <span className="dot dot-primary dot-pulse" title="Running" />}
                      <span className="truncate">{p.name}</span>
                      {isCur && dirty && <span className="mp-dirty" title="Unsaved changes" />}
                    </div>
                    <div className="mp-prog-sub truncate">{p.description || `${p.steps.length} step${p.steps.length === 1 ? "" : "s"}`}</div>
                  </div>
                  <span className="mp-prog-count">{p.steps.length}</span>
                  {pr?.error ? (
                    <Tip text={pr.first}>
                      <CircleAlert size={15} className="mp-bad" />
                    </Tip>
                  ) : pr?.warning ? (
                    <AlertTriangle size={15} className="mp-warn" />
                  ) : null}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={({ toggle }) => (
                        <button type="button" className="mp-icon-btn" aria-label="Program actions" data-tut="mp-prog-menu" onClick={toggle}>
                          <MoreVertical size={14} />
                        </button>
                      )}
                      items={[
                        { label: "Duplicate", icon: Copy, tut: "mp-prog-dup", onClick: () => onDuplicate(p) },
                        { label: "Rename", icon: Pencil, tut: "mp-prog-rename", onClick: () => onRename(p) },
                        "-",
                        { label: "Delete", icon: Trash2, danger: true, tut: "mp-prog-delete", onClick: () => onDelete(p) },
                      ]}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
