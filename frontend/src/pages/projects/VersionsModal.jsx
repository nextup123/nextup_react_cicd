// Saved versions of one project (a backup made by every manual save; autosave makes none), with
// restore and delete (one version or all of them).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Alert, Badge, Button, EmptyState, Loading, Modal } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";
import { formatDate, projectsApi } from "./projectsApi";

export function VersionsModal({ project, onClose, onRestore }) {
  const name = project?.name;
  const [busyId, setBusyId] = useState(null);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["project", "versions", name],
    queryFn: () => projectsApi.versions(name),
    enabled: !!name,
    staleTime: 0,
  });

  if (!project) return null;
  const versions = Array.isArray(data?.versions) ? data.versions : Array.isArray(data) ? data : [];

  const removeOne = async (v) => {
    const ok = await confirm({
      title: "Delete this version?",
      message: `Version ${v.project_version || "?"} saved ${formatDate(v.saved_at)} is deleted permanently. The project itself does not change.`,
      tone: "danger",
      confirmLabel: "Delete version",
    });
    if (!ok) return;
    setBusyId(v.id);
    try {
      await projectsApi.removeVersion(name, v.id);
      toast.success("Version deleted");
      await refetch();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Delete failed" });
    } finally {
      setBusyId(null);
    }
  };

  const removeAll = async () => {
    const ok = await confirm({
      title: "Delete every version?",
      message: `All ${versions.length} saved versions of "${name}" are deleted permanently. The project itself does not change; the next Save makes a new version.`,
      tone: "danger",
      confirmLabel: "Delete all versions",
    });
    if (!ok) return;
    setBusyId("*");
    try {
      const r = await projectsApi.removeAllVersions(name);
      toast.success(`${r?.deleted ?? versions.length} versions deleted`);
      await refetch();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Delete failed" });
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (v) => {
    setBusyId(v.id);
    try {
      const done = await onRestore(project, v);
      if (done) onClose();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      open
      tut="versions"
      size="lg"
      className="pm-modal"
      onClose={onClose}
      title="Version history"
      description={`${name} · current version ${data?.current_version || project.project_version || "—"}`}
      footer={
        <>
          <span className="xs muted grow">Each Save from the console keeps a copy of the project as it was saved (autosave makes no version). Restoring loads that copy as the active project.</span>
          {versions.length > 0 && (
            <Button data-tut="versions-delete-all" variant="soft-danger" icon={Trash2} loading={busyId === "*"} disabled={!!busyId && busyId !== "*"} onClick={removeAll}>
              Delete all
            </Button>
          )}
          <Button onClick={() => refetch()} loading={isFetching && !isLoading}>Refresh</Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {isLoading ? (
        <Loading label="Loading versions…" />
      ) : error ? (
        <Alert tone="danger" title="Could not load versions">{errorMessage(error)}</Alert>
      ) : !versions.length ? (
        <EmptyState icon={History} title="No saved versions yet" text="A version appears here every time the project is saved with Save (autosave keeps the project but makes no version)." />
      ) : (
        <div className="table-wrap pm-versions">
          <table className="table compact">
            <thead>
              <tr>
                <th title="Each Save stores a copy of the project as it was saved.">Version</th>
                <th>Saved</th>
                <th>Saved by</th>
                <th>Backup ID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((v, i) => (
                <tr key={v.id}>
                  <td className="nowrap">
                    <span className="strong tabular">v{v.project_version || "?"}</span>{" "}
                    {i === 0 && <Badge tone="primary">Newest</Badge>}
                  </td>
                  <td className="nowrap">{formatDate(v.saved_at)}</td>
                  <td>{v.saved_by || "—"}</td>
                  <td className="mono xs muted pm-version-id" title={v.id}>{v.id}</td>
                  <td style={{ textAlign: "right" }} className="nowrap">
                    <Button size="sm" variant="soft" icon={RotateCcw} loading={busyId === v.id} disabled={!!busyId && busyId !== v.id} onClick={() => restore(v)} data-tut={i === 0 ? "versions-restore" : undefined}>
                      Restore
                    </Button>{" "}
                    <Button size="sm" variant="ghost" icon={Trash2} disabled={!!busyId} onClick={() => removeOne(v)} title="Delete this version" aria-label="Delete this version" data-tut={i === 0 ? "versions-delete" : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
