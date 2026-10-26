// Motion Programs: create and edit the programs of planning_data/programs.yaml
// (nextup_motion_server run_program) and try them on the robot.
//
// Programs | program settings + steps + path preview | step / run / YAML.
// The rules of the file live in programRules.js (shared with the backend), so
// the editor offers only valid keys for each motion, checks the program while
// it is typed and explains every field on hover.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Code2, ListOrdered, Play, Redo2, RotateCcw, Save, Undo2, Wand2 } from "lucide-react";
import { Button, EmptyState, IconButton, Loading, Tabs, cx } from "../../components/ui";
import { Split } from "../../components/ui/Split";
import { useRobot } from "../../store/robot";
import { toast } from "../../store/toast";
import { confirm, prompt } from "../../store/confirm";
import { errorMessage } from "../../lib/api";
import { NAME_RE, checkProgram, newStep, normalizeProgram } from "./programRules";
import { fromTemplate } from "./programTemplates";
import { programsApi, refreshPrograms, usePrograms, useProgramPoints } from "./programsApi";
import { isDirty, useDraft } from "./draftStore";
import ProgramList from "./ProgramList";
import ProgramSettings from "./ProgramSettings";
import StepList from "./StepList";
import StepInspector from "./StepInspector";
import PathPreview from "./PathPreview";
import RunPanel, { runningStepOf } from "./RunPanel";
import YamlPanel from "./YamlPanel";
import "./programs.css";

const CUR_KEY = "nextup.programs.current";
const TAB_KEY = "nextup.programs.tab";
const remember = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};
const recall = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const inField = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

function ChecksBar({ issues, server, onGo, onFix }) {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warning");
  const all = [...errors, ...warns];
  if (!all.length && !server?.length)
    return (
      <div className="mp-checks is-ok" data-tut="mp-checks">
        <CheckCircle2 size={15} /> Passes the motion server's checks
      </div>
    );
  return (
    <div className={cx("mp-checks", errors.length ? "is-error" : "is-warn")} data-tut="mp-checks">
      <button type="button" className="mp-checks-head" onClick={() => setOpen((o) => !o)}>
        {errors.length ? <CircleAlert size={15} /> : <AlertTriangle size={15} />}
        <span className="grow">
          {errors.length ? `${errors.length} problem${errors.length > 1 ? "s" : ""}: the motion server would refuse this program` : `${warns.length} warning${warns.length > 1 ? "s" : ""}`}
          {errors.length && warns.length ? ` · ${warns.length} warning${warns.length > 1 ? "s" : ""}` : ""}
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="mp-checks-list">
          {all.map((i, k) => (
            <div key={k} className={cx("mp-issue", i.level === "error" ? "is-error" : "is-warn")}>
              {i.step !== null && i.step !== undefined ? (
                <button type="button" className="mp-issue-step" onClick={() => onGo(i.step)}>
                  step {i.step + 1}
                </button>
              ) : (
                <span className="mp-issue-step">program</span>
              )}
              <span className="grow">{i.message}</span>
              {i.fix && (
                <Button size="sm" variant="soft" icon={Wand2} onClick={() => onFix(i.fix)}>
                  {i.fix.label}
                </Button>
              )}
            </div>
          ))}
          {server?.map((m, k) => (
            <div key={`s${k}`} className="mp-issue is-error">
              <span className="mp-issue-step">server</span>
              <span className="grow">{m}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProgramsPage() {
  const q = usePrograms();
  const data = q.data;
  const pts = useProgramPoints();
  const d = useDraft();
  const dirty = isDirty(d);
  const motion = useRobot((s) => s.motion);
  const [tab, setTab] = useState(() => recall(TAB_KEY) || "step");
  const [saving, setSaving] = useState(false);
  const [callOffset, setCallOffset] = useState({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  const programs = useMemo(() => data?.programs || [], [data]);
  const names = useMemo(() => new Set(programs.map((p) => p.name)), [programs]);

  const setTabR = (t) => {
    setTab(t);
    remember(TAB_KEY, t);
  };

  // open the remembered (or first) program once the list is there
  useEffect(() => {
    if (!data || d.draft) return;
    const want = recall(CUR_KEY);
    const p = programs.find((x) => x.name === want) || programs[0];
    if (p) d.open(p);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // the saved program changed on disk (other browser, YAML tab): follow it when not editing
  useEffect(() => {
    if (!data || !d.savedName || dirty) return;
    const p = programs.find((x) => x.name === d.savedName);
    if (p && JSON.stringify(p) !== JSON.stringify(d.base)) d.open(p, { sel: d.sel });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const draft = d.draft;
  const issues = useMemo(() => (draft ? checkProgram(draft, { points: pts.list.length || !pts.loading ? pts.index : undefined }) : []), [draft, pts]);
  const issuesByStep = useMemo(() => {
    const m = {};
    for (const i of issues) if (i.step !== null && i.step !== undefined) (m[i.step] ||= []).push(i);
    return m;
  }, [issues]);
  const hasErrors = issues.some((i) => i.level === "error");
  const serverProblems = useMemo(() => (data?.server?.problems || []).filter((m) => d.savedName && m.startsWith(`${d.savedName}:`) && !dirty), [data, d.savedName, dirty]);
  const runningStep = runningStepOf(motion, d.savedName);
  const runningName = motion?.kind === "program" && motion.active ? motion.target : null;

  const guard = async () => !dirty || (await confirm({ title: "Discard changes?", message: `"${draft?.name}" has unsaved changes.`, tone: "warning", confirmLabel: "Discard" }));

  const openProgram = async (p) => {
    if (!(await guard())) return;
    d.open(p);
    remember(CUR_KEY, p.name);
  };

  const save = useCallback(async () => {
    const s = useDraft.getState();
    if (!s.draft) return null;
    const p = s.draft;
    if (!NAME_RE.test(p.name)) {
      toast.error("Program name: letters, digits, _ and - (up to 64)");
      return null;
    }
    if (names.has(p.name) && p.name !== s.savedName) {
      toast.error(`A program named "${p.name}" already exists`);
      return null;
    }
    const errs = checkProgram(p, { points: pts.index }).filter((i) => i.level === "error");
    if (errs.length && !(await confirm({ title: "Save with problems?", message: `${errs[0].message}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ""}\n\nThe motion server lists the program but refuses to run it until this is fixed.`, tone: "warning", confirmLabel: "Save anyway" }))) return null;
    setSaving(true);
    try {
      const r = await programsApi.save(p, s.savedName || undefined);
      useDraft.getState().saved(normalizeProgram(p));
      remember(CUR_KEY, p.name);
      await refreshPrograms();
      toast.success(r.message || "Saved");
      return p.name;
    } catch (err) {
      toast.error(errorMessage(err), { title: "Not saved" });
      return null;
    } finally {
      setSaving(false);
    }
  }, [names, pts.index]);

  const newFrom = async (tpl) => {
    if (!(await guard())) return;
    d.open(fromTemplate(tpl, names), { isNew: true });
    setTabR("step");
  };
  const duplicate = async (p) => {
    if (!(await guard())) return;
    let name = `${p.name}_copy`;
    for (let i = 2; names.has(name); i++) name = `${p.name}_copy${i}`;
    d.open({ ...JSON.parse(JSON.stringify(p)), name, comment: "" }, { isNew: true });
  };
  const rename = async (p) => {
    const name = await prompt({ title: `Rename ${p.name}`, label: "New name", defaultValue: p.name, hint: "Trees that call RunProgram with the old name must be changed too.", confirmLabel: "Rename" });
    if (!name || name === p.name) return;
    if (!NAME_RE.test(name)) return toast.error("Letters, digits, _ and - only (up to 64)");
    if (names.has(name)) return toast.error(`A program named "${name}" already exists`);
    if (d.savedName === p.name && dirty) return d.edit((x) => ({ ...x, name }));
    try {
      await programsApi.save({ ...p, name }, p.name);
      if (d.savedName === p.name) d.saved({ ...d.draft, name });
      remember(CUR_KEY, name);
      await refreshPrograms();
      toast.success(`Renamed to ${name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (p) => {
    if (!(await confirm({ title: `Delete ${p.name}?`, message: "It is removed from the motion programs (a backup of the previous version is kept). Trees that call it will fail.", tone: "danger", confirmLabel: "Delete" }))) return;
    try {
      await programsApi.remove(p.name);
      if (d.savedName === p.name) {
        const next = programs.find((x) => x.name !== p.name);
        if (next) d.open(next);
        else d.close();
      }
      await refreshPrograms();
      toast.success(`${p.name} deleted`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const createFile = async () => {
    try {
      const r = await programsApi.createFile();
      toast.success(r.message);
      useDraft.getState().close();
      await refreshPrograms();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // step operations
  const addStep = (kind) => {
    const s = useDraft.getState();
    const at = s.sel >= 0 ? Math.min(s.sel + 1, s.draft.steps.length) : s.draft.steps.length;
    const prev = s.draft.steps[at - 1] || null;
    const st = newStep(kind, prev, pts.list.filter((p) => p.hasJoints).map((p) => p.name));
    s.edit((x) => ({ ...x, steps: [...x.steps.slice(0, at), st, ...x.steps.slice(at)] }), null, at);
    setTabR("step");
  };
  const delStep = (i) => {
    const s = useDraft.getState();
    if (s.draft.steps.length <= 1) return toast.warning("A program needs at least one step");
    s.edit((x) => ({ ...x, steps: x.steps.filter((_, k) => k !== i) }), null, Math.max(0, Math.min(i, s.draft.steps.length - 2)));
  };
  const dupStep = (i) => {
    const s = useDraft.getState();
    s.edit((x) => ({ ...x, steps: [...x.steps.slice(0, i + 1), JSON.parse(JSON.stringify(x.steps[i])), ...x.steps.slice(i + 1)] }), null, i + 1);
  };
  const moveStep = (from, to, steps) => {
    const s = useDraft.getState();
    s.edit((x) => ({ ...x, steps: steps || (() => { const a = [...x.steps]; const [m] = a.splice(from, 1); a.splice(to, 0, m); return a; })() }), null, to);
  };
  const applyFix = (fix) => useDraft.getState().edit((x) => fix.patch(x));

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      const s = useDraft.getState();
      if (!s.draft) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (document.querySelector(".overlay")) return; // a dialog is open
      if (mod && e.key.toLowerCase() === "z" && !inField(e)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !inField(e)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (inField(e)) return;
      const n = s.draft.steps.length;
      if (e.key === "Delete" && s.sel >= 0) {
        e.preventDefault();
        delStep(s.sel);
      } else if (mod && e.key.toLowerCase() === "d" && s.sel >= 0) {
        e.preventDefault();
        dupStep(s.sel);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && s.sel >= 0) {
        e.preventDefault();
        const to = s.sel + (e.key === "ArrowUp" ? -1 : 1);
        if (to >= 0 && to < n) moveStep(s.sel, to);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!e.target.closest?.(".mp-page")) return;
        e.preventDefault();
        s.select(Math.max(0, Math.min(n - 1, s.sel + (e.key === "ArrowUp" ? -1 : 1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Loading label="Loading programs…" />;
  if (q.isError)
    return (
      <div className="page">
        <EmptyState icon={CircleAlert} title="Programs could not be loaded" text={errorMessage(q.error)} action={<Button onClick={() => q.refetch()}>Try again</Button>} />
      </div>
    );

  const sel = d.sel;
  const step = draft?.steps[sel];

  const list = (
    <ProgramList
      data={data}
      current={d.savedName}
      dirty={dirty}
      runningName={runningName}
      onOpen={openProgram}
      onNew={newFrom}
      onDuplicate={duplicate}
      onRename={rename}
      onDelete={remove}
      onCreateFile={createFile}
    />
  );

  if (!draft)
    return (
      <div className="page page-fill mp-page">
        <Split id="programs.cols" className="mp-grid" defaults={[1, 3]} min={[220, 380]} gap={12}>
          {list}
          <div className="card mp-center">
            <EmptyState icon={ListOrdered} title="No program open" text="Pick a program on the left or start a new one from a template." />
          </div>
        </Split>
      </div>
    );

  return (
    <div className="page page-fill mp-page">
      <Split id="programs.cols" className="mp-grid" defaults={[0.85, 2.1, 1.45]} min={[200, 400, 330]} gap={12}>
        {list}
        <Split id="programs.center" direction="column" defaults={[3, 2]} min={[240, 160]} gap={10}>
          <div className="card mp-center" data-tut="mp-editor">
            <div className="mp-center-bar">
              <div className="mp-title" data-tut="mp-title">
                <span className="truncate">{draft.name || "unnamed"}</span>
                {!d.savedName && <span className="mp-mini">new</span>}
                {dirty && <span className="mp-mini is-warn">unsaved</span>}
              </div>
              <span className="grow" />
              <IconButton size="sm" icon={Undo2} label="Undo (Ctrl+Z)" data-tut="mp-undo" disabled={!d.past.length} onClick={d.undo} />
              <IconButton size="sm" icon={Redo2} label="Redo (Ctrl+Y)" data-tut="mp-redo" disabled={!d.future.length} onClick={d.redo} />
              {d.base && <IconButton size="sm" icon={RotateCcw} label="Discard changes" data-tut="mp-discard" disabled={!dirty} onClick={d.discard} />}
              <Button size="sm" variant="primary" icon={Save} data-tut="mp-save" loading={saving} disabled={!dirty && Boolean(d.savedName)} onClick={save} title="Save (Ctrl+S)">
                Save
              </Button>
            </div>
            <div className="mp-center-body">
              <ProgramSettings program={draft} points={pts.list} issues={issues} nameTaken={names.has(draft.name) && draft.name !== d.savedName} onChange={(patch, key) => d.edit((x) => ({ ...x, ...patch }), key)} />
              <ChecksBar issues={issues} server={serverProblems} onGo={(i) => (d.select(i), setTabR("step"))} onFix={applyFix} />
              <div className="mp-steps-title">
                <span>Steps</span>
                <span className="muted small">{draft.steps.length} · drag to reorder</span>
              </div>
              <StepList
                program={draft}
                sel={sel}
                runningStep={runningStep}
                issuesByStep={issuesByStep}
                onSelect={(i) => {
                  d.select(i);
                  if (tab !== "step") setTabR("step");
                }}
                onMove={moveStep}
                onDelete={delStep}
                onDuplicate={dupStep}
                onAdd={addStep}
              />
            </div>
          </div>
          <div className="card mp-preview-card" data-tut="mp-preview">
            <PathPreview program={draft} lookup={pts.lookup} sel={sel} runningStep={runningStep} onSelect={(i) => d.select(i)} callOffset={tab === "run" ? callOffset : null} running={Boolean(runningName)} />
          </div>
        </Split>
        <div className="card mp-side" data-tut="mp-side">
          <Tabs
            className="mp-tabs"
            value={tab}
            onChange={setTabR}
            tabs={[
              { value: "step", label: step ? `Step ${sel + 1}` : "Step", icon: ListOrdered },
              { value: "run", label: "Run", icon: Play },
              { value: "yaml", label: "Text", icon: Code2 },
            ]}
          />
          <div className="mp-side-body">
            {tab === "step" &&
              (step ? (
                <StepInspector
                  key={sel}
                  step={step}
                  index={sel}
                  steps={draft.steps}
                  program={draft}
                  points={pts.list}
                  issues={issuesByStep[sel] || []}
                  onChange={(patch, key) => d.editStep(sel, patch, key)}
                  onDelete={() => delStep(sel)}
                  onDuplicate={() => dupStep(sel)}
                  onFix={applyFix}
                />
              ) : (
                <EmptyState compact title="No step selected" text="Pick a step in the list, or add one." />
              ))}
            {tab === "run" && (
              <RunPanel program={draft} savedName={d.savedName} dirty={dirty} hasErrors={hasErrors} canRun={data?.canRun} canFinish={data?.canFinish} onSave={save} offset={callOffset} setOffset={setCallOffset} />
            )}
            {tab === "yaml" && <YamlPanel program={draft} dirty={dirty} />}
          </div>
        </div>
      </Split>
    </div>
  );
}
