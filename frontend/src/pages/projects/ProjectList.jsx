// Project browser: grid cards or a compact table, each with its actions.
import { Copy, FolderOpen, History, Pencil, Trash2, User, Package, Clock } from "lucide-react";
import { Badge, Button, IconButton, cx } from "../../components/ui";
import { formatDate } from "./projectsApi";

function StateBadge({ project, active, dirty }) {
  if (project.state === "INVALID") return <Badge tone="warning" title={project.error}>Invalid</Badge>;
  if (active && dirty) return <Badge tone="warning" dot>Unsaved changes</Badge>;
  if (active) return <Badge tone="success" dot>Active</Badge>;
  return null;
}

function actionsFor(project, { active, busy, on }) {
  const invalid = project.state === "INVALID";
  const why = invalid ? "This project has no valid project settings" : busy ? "Another operation is running" : undefined;
  return [
    {
      key: "load",
      label: "Load",
      icon: FolderOpen,
      variant: "soft",
      disabled: active || invalid || !!busy,
      title: active ? "Already the active project" : why || "Make this the active project",
      onClick: () => on.load(project),
    },
    { key: "rename", label: "Rename", icon: Pencil, disabled: invalid || !!busy, title: why || "Rename project", onClick: () => on.rename(project) },
    { key: "copy", label: "Copy", icon: Copy, disabled: invalid || !!busy, title: why || "Duplicate project", onClick: () => on.copy(project) },
    { key: "versions", label: "Versions", icon: History, disabled: invalid, title: why || "Saved versions", onClick: () => on.versions(project) },
    {
      key: "delete",
      label: "Delete",
      icon: Trash2,
      variant: "ghost-danger",
      disabled: active || !!busy,
      title: active ? "The active project cannot be deleted. Load another project first." : busy ? why : "Delete project",
      onClick: () => on.remove(project),
    },
  ];
}

export function ProjectGrid({ projects, activeName, dirty, busy, on }) {
  return (
    <div className="pm-grid">
      {projects.map((p) => {
        const active = p.name === activeName;
        const actions = actionsFor(p, { active, busy, on });
        return (
          <article key={p.name} className={cx("pm-card", active && "is-active", active && dirty && "is-dirty")} data-tut-project={p.name} data-tut={active ? "pm-card-active" : "pm-card"}>
            <div className="pm-card-head">
              <div className="pm-card-name truncate" title={p.name}>{p.name}</div>
              <StateBadge project={p} active={active} dirty={dirty} />
            </div>
            <div className="pm-card-meta">
              <span title="Owner"><User size={13} /> {p.owner || "Unknown"}</span>
              <span title="Project type"><Package size={13} /> {p.project_type || "—"}</span>
              <span title="Project version" className="tabular">v{p.project_version || "1.0.0"}</span>
            </div>
            <div className="pm-card-desc" title={p.description || ""}>{p.description || <span className="faint">No description</span>}</div>
            <div className="pm-card-date" title="Last modified">
              <Clock size={13} /> {p.last_modified ? `Modified ${formatDate(p.last_modified, true)}` : `Created ${formatDate(p.created_at, true)}`}
            </div>
            <div className="pm-card-actions">
              {actions.map((a) =>
                a.key === "load" ? (
                  <Button key={a.key} size="sm" variant={a.variant} icon={a.icon} disabled={a.disabled} title={a.title} onClick={a.onClick} data-tut={`pm-${a.key}`}>
                    {active ? "Loaded" : a.label}
                  </Button>
                ) : (
                  <IconButton key={a.key} size="sm" variant={a.variant || "ghost"} icon={a.icon} label={a.title} disabled={a.disabled} onClick={a.onClick} data-tut={`pm-${a.key}`} />
                )
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ProjectTable({ projects, activeName, dirty, busy, on }) {
  return (
    <div className="table-wrap pm-table">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Owner</th>
            <th>Type</th>
            <th>Version</th>
            <th>Created</th>
            <th>Modified</th>
            <th style={{ textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const active = p.name === activeName;
            const actions = actionsFor(p, { active, busy, on });
            return (
              <tr key={p.name} className={cx(active && "pm-row-active")} data-tut-project={p.name} data-tut={active ? "pm-card-active" : "pm-card"}>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="strong truncate pm-table-name" title={p.description || p.name}>{p.name}</span>
                    <StateBadge project={p} active={active} dirty={dirty} />
                  </div>
                </td>
                <td>{p.owner || "—"}</td>
                <td>{p.project_type || "—"}</td>
                <td className="tabular">{p.project_version || "—"}</td>
                <td className="nowrap">{formatDate(p.created_at)}</td>
                <td className="nowrap">{formatDate(p.last_modified)}</td>
                <td>
                  <div className="pm-table-actions">
                    {actions.map((a) => (
                      <IconButton key={a.key} size="sm" variant={a.key === "load" ? "soft" : a.variant || "ghost"} icon={a.icon} label={a.title} disabled={a.disabled} onClick={a.onClick} data-tut={`pm-${a.key}`} />
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
