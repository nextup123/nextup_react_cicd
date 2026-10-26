// description_error.txt: free text the service team keeps about known errors.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pencil, Save, X } from "lucide-react";
import { Alert, Badge, Button, Card, Loading, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";

export function DescriptionEditor({ onDirtyChange }) {
  const q = useQuery({ queryKey: ["diagnostics", "description"], queryFn: () => api.text("/error-logs/description"), staleTime: 0, refetchOnWindowFocus: false });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = editing && text !== (q.data ?? "");

  useEffect(() => {
    if (!editing) setText(q.data ?? "");
  }, [q.data, editing]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/error-logs/description", { content: text });
      toast.success("Description saved");
      await q.refetch();
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err), { title: "Could not save the description" });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (dirty && !(await confirm({ title: "Discard edits?", message: "Your changes to the description are lost.", tone: "danger", confirmLabel: "Discard" }))) return;
    setEditing(false);
    setText(q.data ?? "");
  };

  return (
    <Card
      className="dg-panel"
      tut="dg-desc"
      bodyClassName="dg-panel-body"
      icon={FileText}
      title="Error description"
      subtitle="Notes about known errors and how to handle them (description_error.txt)"
      actions={
        editing ? (
          <>
            {dirty && <Badge tone="warning" dot>Unsaved edits</Badge>}
            <Button size="sm" variant="ghost" icon={X} data-tut="dg-desc-cancel" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="primary" icon={Save} data-tut="dg-desc-save" loading={saving} disabled={!dirty} title={dirty ? undefined : "No changes to save"} onClick={save}>Save</Button>
          </>
        ) : (
          <Button size="sm" icon={Pencil} data-tut="dg-desc-edit" onClick={() => setEditing(true)} disabled={q.isLoading || !!q.error} title={q.error ? "The description could not be loaded" : undefined}>Edit</Button>
        )
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <Alert tone="danger" title="Could not load the description" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>{errorMessage(q.error)}</Alert>
      ) : (
        <Textarea className="dg-desc" data-tut="dg-desc-text" value={text} readOnly={!editing} onChange={(e) => setText(e.target.value)} placeholder={editing ? "Write the description…" : "No description yet. Click Edit to add one."} />
      )}
    </Card>
  );
}
