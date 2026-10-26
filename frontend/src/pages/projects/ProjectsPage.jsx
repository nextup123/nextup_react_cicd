// Projects (old "Project Manager"): active project summary with save / save as /
// discard / versions, project browser with load, rename, copy, delete and
// version restore, project creation, autosave and live unsaved-changes state.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown, FilePlus2, FileText, FolderKanban, FolderPlus, History, LayoutGrid, List, Plus, Save, SaveAll, Undo2,
} from "lucide-react";
import {
  Alert, Badge, Button, Card, EmptyState, Loading, Menu, SearchInput, Segmented, StatusDot, Switch,
} from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { invalidate, useActiveProject, useProjects } from "../../lib/queries";
import { formatDate, projectsApi } from "./projectsApi";
import { setAutosave, useIsDirty, useProjectSession } from "../../store/projectSession";
import { useProjectActions } from "./useProjectActions";
import { useChoice } from "./ChoiceModal";
import { ProjectFormModal } from "./ProjectFormModal";
import { VersionsModal } from "./VersionsModal";
import { ProjectGrid, ProjectTable } from "./ProjectList";
import { useBridge } from "../../tutorial/bridge";
import "./projects.css";

const PREF = { view: "nextup.projects.view", sort: "nextup.projects.sort" };
const readPref = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const writePref = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const SORTS = [
  { value: "name", label: "Name" },
  { value: "modified", label: "Modified" },
  { value: "created", label: "Created" },
];

function sortProjects(list, sortBy) {
  const time = (v) => (v ? new Date(v).getTime() || 0 : 0);
  return [...list].sort((a, b) => {
    if (sortBy === "modified") return time(b.last_modified || b.created_at) - time(a.last_modified || a.created_at);
    if (sortBy === "created") return time(b.created_at) - time(a.created_at);
    return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
  });
}

function Detail({ label, children }) {
  return (
    <div className="pm-detail">
      <span className="section-label">{label}</span>
      <span className="pm-detail-value" title={typeof children === "string" ? children : undefined}>{children || "—"}</span>
    </div>
  );
}

export default function ProjectsPage() {
  const activeQ = useActiveProject();
  const listQ = useProjects();
  const activeName = activeQ.data?.active_project || null;
  const projects = useMemo(() => (Array.isArray(listQ.data?.projects) ? listQ.data.projects : []), [listQ.data]);

  const detailsQ = useQuery({
    queryKey: ["project", "details", activeName],
    queryFn: () => projectsApi.details(activeName),
    enabled: !!activeName,
  });
  const active = detailsQ.data || projects.find((p) => p.name === activeName) || null;

  // Unsaved-changes state and autosave are run by the app shell on every page.
  const connected = useProjectSession((s) => s.connected);
  const autosave = useProjectSession((s) => s.autosave);
  const dirty = useIsDirty();

  const [ask, choiceDialog] = useChoice();
  const actions = useProjectActions({ activeName, dirty, projects, ask });

  // View preferences
  const [view, setView] = useState(() => readPref(PREF.view, "grid"));
  const [sortBy, setSortBy] = useState(() => readPref(PREF.sort, "name"));
  const [search, setSearch] = useState("");
  useEffect(() => writePref(PREF.view, view), [view]);
  useEffect(() => writePref(PREF.sort, sortBy), [sortBy]);

  // Modals
  const [form, setForm] = useState(null);
  const [versionsOf, setVersionsOf] = useState(null);

  const openNew = () =>
    setForm({
      title: "New project",
      description: "Creates the project folder. Load it afterwards to start working in it.",
      submitLabel: "Create project",
      showType: true,
      defaults: { project_type: "standard" },
      onSubmit: actions.create,
    });
  const openCopy = (project) =>
    setForm({
      title: `Copy "${project.name}"`,
      description: "Duplicates all files of the saved project under a new name.",
      submitLabel: "Create copy",
      defaults: { name: `${project.name} (copy)`, owner: project.owner || "", description: "" },
      onSubmit: (values) => actions.copy(project, values),
    });
  const openSaveAs = () =>
    setForm({
      title: "Save as new project",
      description: `Copies "${activeName}" to a new project and makes the copy active.`,
      submitLabel: "Save as",
      defaults: { name: `${activeName}_copy`, owner: active?.owner || "Nextup", description: active?.description || "" },
      note: dirty ? `Unsaved changes are saved into "${activeName}" first, after you confirm.` : null,
      onSubmit: actions.saveAs,
    });

  const on = {
    load: actions.load,
    rename: actions.rename,
    copy: openCopy,
    versions: setVersionsOf,
    remove: actions.remove,
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? projects.filter((p) =>
          [p.name, p.owner, p.project_type, p.description].some((v) => String(v || "").toLowerCase().includes(q))
        )
      : projects;
    return sortProjects(list, sortBy);
  }, [projects, search, sortBy]);

  const busy = actions.busy;
  useBridge("projects", { activeName, dirty, names: projects.map((p) => p.name), search });

  return (
    <div className="page pm-page">
      {/* ── Active project ───────────────────────────── */}
      <Card
        className="pm-active"
        tut="pm-active"
        icon={FolderKanban}
        title="Active project"
        subtitle="Points, paths, IO and settings are edited in this project's working copy"
        actions={
          <>
            <span className="pm-stream" title={connected ? "Live change tracking connected" : "Live change tracking disconnected; state may be out of date"}>
              <StatusDot tone={connected ? "success" : "off"} /> {connected ? "Live" : "Offline"}
            </span>
            <Switch
              size="sm"
              checked={autosave}
              onChange={setAutosave}
              label="Autosave"
              title="Save automatically every 10 seconds while there are unsaved changes (only while this page is open)"
            />
          </>
        }
      >
        {activeQ.isLoading ? (
          <Loading label="Reading active project…" />
        ) : activeQ.error ? (
          <Alert tone="danger" title="Could not read the active project">{errorMessage(activeQ.error)}</Alert>
        ) : !activeName ? (
          <EmptyState icon={FolderKanban} title="No project loaded" text="Load a project from the list below, or create a new one." compact />
        ) : (
          <div className="pm-active-body">
            <div className="pm-active-main">
              <div className="pm-active-title">
                <span className="pm-active-name truncate" title={activeName}>{activeName}</span>
                {dirty ? <Badge tone="warning" size="lg" dot>Unsaved changes</Badge> : <Badge tone="success" size="lg" dot>All changes saved</Badge>}
              </div>
              {active?.description && <div className="muted small pm-active-desc">{active.description}</div>}
              <div className="pm-details">
                <Detail label="Owner">{active?.owner}</Detail>
                <Detail label="Type">{active?.project_type}</Detail>
                <Detail label="Version">{active?.project_version ? `v${active.project_version}` : null}</Detail>
                <Detail label="Created">{formatDate(active?.created_at)}</Detail>
                <Detail label="Last saved">{active?.last_modified ? formatDate(active.last_modified) : "Never"}</Detail>
              </div>
            </div>
            <div className="pm-active-actions">
              <Button data-tut="pm-save" variant="primary" icon={Save} loading={busy === "save"} disabled={!!busy && busy !== "save"} onClick={actions.save} title="Save the working copy into the project (keeps the previous state as a version)">
                Save project
              </Button>
              <Button data-tut="pm-saveas" icon={SaveAll} disabled={!!busy} onClick={openSaveAs} title="Copy this project under a new name and switch to the copy">
                Save as…
              </Button>
              <Button data-tut="pm-active-versions" icon={History} onClick={() => setVersionsOf({ ...(active || {}), name: activeName })} title="Saved versions of this project">
                Versions
              </Button>
              <Button
                variant="ghost-danger"
                data-tut="pm-discard"
                icon={Undo2}
                loading={busy === "discard"}
                disabled={!dirty || (!!busy && busy !== "discard")}
                onClick={actions.discardChanges}
                title={dirty ? "Reload the last saved state and lose unsaved changes" : "There are no unsaved changes"}
              >
                Discard changes
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Project browser ──────────────────────────── */}
      <Card
        className="pm-browser"
        tut="pm-browser"
        bodyClassName="pm-browser-body"
        icon={FolderPlus}
        title="Projects"
        subtitle={listQ.isLoading ? "Loading…" : `${projects.length} project${projects.length === 1 ? "" : "s"} on the robot`}
        actions={
          <>
            <Button data-tut="pm-new" variant="primary" icon={Plus} onClick={openNew} disabled={!!busy}>
              New project
            </Button>
            <Menu
              trigger={({ toggle }) => (
                <Button data-tut="pm-quick" iconRight={ChevronDown} onClick={toggle} disabled={!!busy} loading={busy === "create"}>
                  Quick create
                </Button>
              )}
              items={[
                { label: "Default project (standard template) and load it", icon: FilePlus2, onClick: () => actions.createQuick("standard") },
                { label: "Blank project and load it", icon: FileText, onClick: () => actions.createQuick("blank") },
              ]}
            />
          </>
        }
      >
        <div className="pm-toolbar" data-tut="pm-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, owner, type, description…" className="pm-search" />
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted">Sort</span>
            <Segmented options={SORTS} value={sortBy} onChange={setSortBy} ariaLabel="Sort projects" />
          </div>
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Cards", icon: LayoutGrid },
              { value: "list", label: "Table", icon: List },
            ]}
          />
          {search && <span className="small muted">{filtered.length} of {projects.length} shown</span>}
        </div>

        <div className="pm-list-scroll" data-tut="pm-list">
          {listQ.isLoading ? (
            <Loading label="Loading projects…" />
          ) : listQ.error ? (
            <Alert tone="danger" title="Could not load projects" action={<Button size="sm" onClick={() => listQ.refetch()}>Retry</Button>}>
              {errorMessage(listQ.error)}
            </Alert>
          ) : !projects.length ? (
            <EmptyState icon={FolderKanban} title="No projects yet" text='Use "New project" to create the first one.' />
          ) : !filtered.length ? (
            <EmptyState title="No matching projects" text={`Nothing matches "${search}".`} action={<Button size="sm" onClick={() => setSearch("")}>Clear search</Button>} />
          ) : view === "list" ? (
            <ProjectTable projects={filtered} activeName={activeName} dirty={dirty} busy={busy} on={on} />
          ) : (
            <ProjectGrid projects={filtered} activeName={activeName} dirty={dirty} busy={busy} on={on} />
          )}
        </div>
      </Card>

      <ProjectFormModal form={form} projects={projects} onClose={() => setForm(null)} />
      <VersionsModal project={versionsOf} onClose={() => setVersionsOf(null)} onRestore={actions.restore} />
      {choiceDialog}
    </div>
  );
}
