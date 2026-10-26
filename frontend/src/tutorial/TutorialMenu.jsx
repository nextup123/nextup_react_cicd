// Lesson picker (the graduation-cap button beside the theme button): the
// lessons of each page, grouped, with progress. Starting a lesson on another
// page goes there first.
import { useMemo, useState } from "react";
import { Check, GraduationCap, Keyboard, Play, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Button, Modal, cx } from "../components/ui";
import { confirm } from "../store/confirm";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/api";
import { useNodeTypes } from "../pages/tree/treeApi";
import { closeMenu, resetProgress, startLesson, useTutorial } from "./engine";
import { PAGES, allLessons } from "./lessons";
import { PRACTICE, removePractice, resetPractice } from "./lessons/treeKit";

const GROUP_HINT = {
  "Edit the program (mouse, then keys)": "each lesson: first with the mouse, then with the shortcut",
  Nodes: "nodes that behave alike are taught together",
};

function MenuBody({ initialPage }) {
  const done = useTutorial((s) => s.done);
  const nodeTypes = useNodeTypes();
  const lessons = useMemo(() => allLessons(nodeTypes.data), [nodeTypes.data]);
  const [page, setPage] = useState(() => PAGES.find((p) => initialPage?.startsWith(p.path))?.path || PAGES[0].path);
  const list = lessons.filter((l) => l.page?.startsWith(page));
  const groups = [];
  for (const l of list) {
    let g = groups.find((x) => x.title === l.group);
    if (!g) groups.push((g = { title: l.group, items: [] }));
    g.items.push(l);
  }
  const nDone = list.filter((l) => done.has(l.id)).length;
  const pct = list.length ? Math.round((nDone / list.length) * 100) : 0;
  const pageInfo = PAGES.find((p) => p.path === page);
  const allDone = lessons.filter((l) => done.has(l.id)).length;

  const practice = async (what) => {
    const ok = await confirm({
      title: what === "reset" ? "Start the practice area fresh?" : "Remove the practice area?",
      message:
        what === "reset"
          ? `Everything in the ${PRACTICE} subtree is removed and it starts empty again. Your real program is not touched.`
          : `The ${PRACTICE} subtree is deleted. Lessons make it again when needed. Your real program is not touched.`,
      tone: "warning",
      confirmLabel: what === "reset" ? "Start fresh" : "Remove",
    });
    if (!ok) return;
    try {
      await (what === "reset" ? resetPractice() : removePractice());
      toast.success(what === "reset" ? "Practice area is fresh" : "Practice area removed");
    } catch (err) {
      toast.error(errorMessage(err), { title: "Could not change the practice area" });
    }
  };

  return (
    <>
      <div className="tut-menu-tabs" role="tablist">
        {PAGES.map((p) => {
          const items = lessons.filter((l) => l.page?.startsWith(p.path));
          const d = items.filter((l) => done.has(l.id)).length;
          return (
            <button key={p.path} type="button" role="tab" aria-selected={page === p.path} className={cx("tut-tab", page === p.path && "is-on")} onClick={() => setPage(p.path)}>
              <p.icon size={15} />
              {p.label}
              <span className="tut-ring" style={{ "--p": items.length ? (d / items.length) * 100 : 0 }} title={`${d} of ${items.length} done`} />
            </button>
          );
        })}
      </div>

      <div className="tut-hero">
        <div className="tut-hero-ring" style={{ "--p": pct }}>
          <span>{pct}%</span>
        </div>
        <div className="tut-hero-text">
          <div className="tut-hero-title">{pageInfo?.label}: {nDone} of {list.length} lessons done</div>
          <div className="tut-hero-sub">
            {nDone === list.length && list.length
              ? "All done here. Hurray! Try another page, or replay any lesson."
              : "Every lesson runs on the real page: the light shows where to click, and you do it yourself."}
            {" "}{allDone} lessons done in total.
          </div>
        </div>
      </div>

      {page === "/tree" && nodeTypes.isLoading && <div className="small muted" style={{ marginBottom: 10 }}>Loading the node library for the node lessons…</div>}

      {groups.map((g) => (
        <div key={g.title} className="tut-group">
          <div className="tut-group-title">
            {g.title}
            {GROUP_HINT[g.title] && <span className="tut-group-hint">· {GROUP_HINT[g.title]}</span>}
          </div>
          <div className="tut-grid">
            {g.items.map((l) => {
              const isDone = done.has(l.id);
              const Icon = isDone ? Check : l.icon || GraduationCap;
              return (
                <button key={l.id} type="button" className={cx("tut-item", isDone && "is-done")} onClick={() => startLesson(l)} title={isDone ? "Done. Click to play it again." : "Start this lesson"}>
                  <span className="tut-item-icon"><Icon size={17} /></span>
                  <span className="tut-item-body">
                    <span className="tut-item-title">{l.title}</span>
                    <span className="tut-item-blurb">{l.blurb}</span>
                    <span className="tut-item-meta">
                      {l.swatches && (
                        <span className="tut-swatches">
                          {l.swatches.slice(0, 8).map((c, i) => <i key={i} style={{ background: c }} />)}
                        </span>
                      )}
                      {l.motion && <span className="tut-chip is-motion"><TriangleAlert size={10} /> robot moves</span>}
                      {/keys/i.test(l.group || "") || /keyboard/i.test(l.title) ? <span className="tut-chip is-keys"><Keyboard size={10} /> keys</span> : null}
                      {isDone ? <span className="tut-chip">done</span> : <span className="tut-chip"><Play size={9} /> start</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="tut-menu-foot">
        {page === "/tree" && (
          <>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => practice("reset")} title={`Empty the ${PRACTICE} subtree`}>
              Fresh practice area
            </Button>
            <Button size="sm" variant="ghost-danger" icon={Trash2} onClick={() => practice("remove")} title={`Delete the ${PRACTICE} subtree`}>
              Remove practice area
            </Button>
          </>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        {nDone > 0 && (
          <Button size="sm" variant="ghost" onClick={() => resetProgress(list.map((l) => l.id))} title="Mark this page's lessons as not done">
            Reset progress
          </Button>
        )}
      </div>
    </>
  );
}

export function TutorialMenu() {
  const open = useTutorial((s) => s.menuOpen);
  const page = useTutorial((s) => s.menuPage);
  return (
    <Modal open={open} onClose={closeMenu} title="Tutorials" description="Short hands-on lessons. Pick one and follow the light." className="tut-menu" icon={<span className="tut-badge is-menu"><GraduationCap size={18} /></span>}>
      {open && <MenuBody initialPage={page} />}
    </Modal>
  );
}
