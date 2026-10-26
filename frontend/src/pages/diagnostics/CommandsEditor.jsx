// Commands notebook (commands.json): notes and shell commands the service
// team keeps for this robot. Cells can be edited, copied, reordered and removed.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Copy, Plus, Save, SquareTerminal, StickyNote, Trash2, Undo2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Loading, Textarea, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { confirm } from "../../store/confirm";
import { toast } from "../../store/toast";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for http://robot-ip pages.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CommandsEditor({ onDirtyChange }) {
  const q = useQuery({ queryKey: ["diagnostics", "commands"], queryFn: () => api.get("/error-logs/commands"), staleTime: 0, refetchOnWindowFocus: false });
  const [cells, setCells] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    if (q.data && !dirty) setCells(Array.isArray(q.data.cells) ? q.data.cells.map((c) => ({ type: c.type === "command" ? "command" : "text", content: c.content || "" })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const change = (fn) => {
    setCells((cs) => fn(cs.slice()));
    setDirty(true);
  };
  const add = (type) => change((cs) => [...cs, { type, content: "" }]);
  const move = (i, d) => change((cs) => { const [c] = cs.splice(i, 1); cs.splice(i + d, 0, c); return cs; });
  const remove = async (i) => {
    if (cells[i].content && !(await confirm({ title: "Remove this cell?", message: "The cell is removed when you save.", tone: "danger", confirmLabel: "Remove" }))) return;
    change((cs) => { cs.splice(i, 1); return cs; });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/error-logs/commands", { cells: cells.map((c) => ({ type: c.type, content: c.content.trim() })) });
      setDirty(false);
      toast.success("Commands saved");
      q.refetch();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    if (!(await confirm({ title: "Discard edits?", message: "Reload the saved commands and lose your edits.", tone: "danger", confirmLabel: "Discard" }))) return;
    setDirty(false);
    setCells((q.data?.cells || []).map((c) => ({ type: c.type === "command" ? "command" : "text", content: c.content || "" })));
  };

  const doCopy = async (i) => {
    if (await copyText(cells[i].content)) {
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
    } else toast.error("Could not copy to the clipboard");
  };

  return (
    <Card
      className="dg-panel"
      tut="dg-commands"
      bodyClassName="dg-panel-body"
      icon={SquareTerminal}
      title="Commands notebook"
      subtitle="Notes and shell commands for service work (commands.json)"
      actions={
        <>
          {dirty && <Badge tone="warning" dot>Unsaved edits</Badge>}
          <Button size="sm" icon={StickyNote} data-tut="dg-cmd-note" onClick={() => add("text")}>Add note</Button>
          <Button size="sm" icon={Plus} data-tut="dg-cmd-add" onClick={() => add("command")}>Add command</Button>
          {dirty && <Button size="sm" variant="ghost" icon={Undo2} data-tut="dg-cmd-discard" onClick={revert}>Discard</Button>}
          <Button size="sm" variant="primary" icon={Save} data-tut="dg-cmd-save" loading={saving} disabled={!dirty} title={dirty ? "Save all cells" : "No changes to save"} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="dg-scroll">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <Alert tone="danger" title="Could not load commands">{errorMessage(q.error)}</Alert>
        ) : !cells.length ? (
          <EmptyState icon={SquareTerminal} title="No cells yet" text="Add a note or a command." compact />
        ) : (
          <div className="dg-cells" data-tut="dg-cmd-cells">
            {cells.map((c, i) => (
              <div key={i} className={cx("dg-cell", c.type === "command" && "is-command")}>
                <div className="dg-cell-side">
                  <span className="xs muted strong">{c.type === "command" ? "COMMAND" : "NOTE"}</span>
                  <div className="row" style={{ gap: 0 }}>
                    <IconButton size="sm" icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton size="sm" icon={ArrowDown} label="Move down" disabled={i === cells.length - 1} onClick={() => move(i, 1)} />
                  </div>
                </div>
                <Textarea
                  className={cx("dg-cell-input", c.type === "command" && "mono")}
                  rows={Math.min(8, Math.max(2, c.content.split("\n").length))}
                  value={c.content}
                  placeholder={c.type === "command" ? "e.g. ros2 node list" : "Describe what the next command does…"}
                  spellCheck={c.type !== "command"}
                  onChange={(e) => { const v = e.target.value; change((cs) => { cs[i] = { ...cs[i], content: v }; return cs; }); }}
                />
                <div className="dg-cell-actions">
                  {c.type === "command" && (
                    <IconButton size="sm" icon={copied === i ? Check : Copy} label={copied === i ? "Copied" : "Copy command"} disabled={!c.content} onClick={() => doCopy(i)} />
                  )}
                  <IconButton size="sm" variant="ghost-danger" icon={Trash2} label="Remove cell" onClick={() => remove(i)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
