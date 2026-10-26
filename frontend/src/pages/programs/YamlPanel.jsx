// YAML of the program as it will be saved, and the whole programs.yaml for
// people who prefer to type (validated by the server before it is written).
import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { Copy, FileCode2, Save } from "lucide-react";
import { Alert, Button, Segmented, Textarea } from "../../components/ui";
import { toast } from "../../store/toast";
import { confirm } from "../../store/confirm";
import { errorMessage } from "../../lib/api";
import { programToYaml } from "./programRules";
import { programsApi, refreshPrograms } from "./programsApi";

/** Program as YAML, steps one per line with their notes as comments (like the file). */
export function programYaml(p) {
  const text = yaml.dump([programToYaml(p)], { flowLevel: 3, lineWidth: -1, noRefs: true });
  let k = 0;
  return text
    .split("\n")
    .map((line) => {
      if (!/^\s+- \{/.test(line)) return line;
      const note = p.steps[k++]?.note;
      return note ? `${line}   # ${note}` : line;
    })
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

export default function YamlPanel({ program, dirty }) {
  const [mode, setMode] = useState("program");
  const [raw, setRaw] = useState(null);
  const [edit, setEdit] = useState("");
  const [busy, setBusy] = useState(false);
  const text = useMemo(() => programYaml(program), [program]);
  useEffect(() => {
    if (mode !== "file") return;
    programsApi
      .raw()
      .then((r) => {
        setRaw(r);
        setEdit(r.text || "");
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [mode]);

  const parseErr = useMemo(() => {
    if (mode !== "file") return null;
    try {
      const d = yaml.load(edit);
      if (d && d.programs !== undefined && !Array.isArray(d.programs) && typeof d.programs !== "object") return "'programs' must be a list or a map";
      return null;
    } catch (e) {
      return e.message.split("\n")[0];
    }
  }, [edit, mode]);

  const saveFile = async () => {
    if (dirty && !(await confirm({ title: "Replace the file?", message: "The program you are editing has unsaved changes; saving the file text replaces them.", tone: "warning", confirmLabel: "Save file" }))) return;
    setBusy(true);
    try {
      const r = await programsApi.saveRaw(edit);
      toast.success(r.message || "Saved");
      refreshPrograms();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-yaml" data-tut="mp-yaml">
      <div className="mp-yaml-bar" data-tut="mp-yaml-bar">
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "program", label: "This program", title: "What this program looks like as saved" },
            { value: "file", label: "Whole file", title: "Edit all programs as text" },
          ]}
        />
        <span className="grow" />
        {mode === "program" ? (
          <Button size="sm" icon={Copy} data-tut="mp-yaml-copy" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("Copied"), () => toast.warning("Copy is blocked by the browser"))}>
            Copy
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={Save} data-tut="mp-yaml-save" loading={busy} disabled={Boolean(parseErr) || raw?.text === edit} onClick={saveFile}>
            Save file
          </Button>
        )}
      </div>
      {mode === "program" ? (
        <pre className="mp-yaml-pre" data-tut="mp-yaml-pre">{text}</pre>
      ) : (
        <>
          {raw && (
            <div className="xs muted mp-yaml-file">
              <FileCode2 size={12} /> All motion programs
              {!raw.exists && " (not created yet)"}
            </div>
          )}
          {parseErr && (
            <Alert tone="danger" title="The text has a mistake">
              {parseErr}
            </Alert>
          )}
          <Textarea className="mp-yaml-edit" spellCheck={false} value={edit} onChange={(e) => setEdit(e.target.value)} />
        </>
      )}
    </div>
  );
}
