// Create a custom node type in the node library (nodes.json, /addCustomNode).
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Field, IconButton, Input, Modal, Segmented, Select } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { invalidate } from "../../lib/queries";
import { toast } from "../../store/toast";
import { treeApi } from "./treeApi";
import { CUSTOM_NODE_GROUPS } from "./treeModel";

const NEW = "__new__";
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CAT_RE = /^[a-z0-9_]+$/;
const GROUP_HINT = {
  Action: "Performs an operation",
  Condition: "Checks a state",
  Control: "Controls the flow of its children",
  Decorator: "Changes the result of one child",
};

export default function CustomNodeModal({ open, onClose, lib }) {
  const [name, setName] = useState("");
  const [cat, setCat] = useState("");
  const [newCat, setNewCat] = useState("");
  const [group, setGroup] = useState("Action");
  const [kind, setKind] = useState("leaf");
  const [attrs, setAttrs] = useState([{ k: "", v: "" }]);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCat(lib?.categories[0]?.key || NEW);
    setNewCat("");
    setGroup("Action");
    setKind("leaf");
    setAttrs([{ k: "", v: "" }]);
    setTried(false);
  }, [open, lib]);

  if (!open) return null;

  const category = cat === NEW ? newCat.trim().toLowerCase() : cat;
  const existing = lib?.categories.find((c) => c.key === category);
  const nameErr = !name.trim()
    ? "Enter a name"
    : !NAME_RE.test(name.trim())
      ? "Letters, digits and _ only, not starting with a digit (it becomes the node type name)"
      : existing?.nodes.some((n) => n.name === name.trim() && n.group === group)
        ? "This category already has a node with that name"
        : null;
  const catErr = !category
    ? "Enter a category key"
    : cat === NEW && !CAT_RE.test(category)
      ? "Lowercase letters, digits and _ only"
      : cat === NEW && lib?.categories.some((c) => c.key === category)
        ? "This category already exists, pick it from the list"
        : null;
  const attrKeys = attrs.map((a) => a.k.trim()).filter(Boolean);
  const attrErr = attrKeys.some((k) => !NAME_RE.test(k))
    ? "Setting names: letters, digits and _ only"
    : new Set(attrKeys).size !== attrKeys.length
      ? "Setting names must be unique"
      : null;
  const invalid = nameErr || catErr || attrErr;

  const save = async () => {
    setTried(true);
    if (invalid) return;
    const attributes = {};
    attrs.forEach(({ k, v }) => k.trim() && (attributes[k.trim()] = v.trim()));
    setSaving(true);
    try {
      await treeApi.addCustomNode({ name: name.trim(), category, nodeType: group, isWrapper: kind === "wrapper", attributes });
      toast.success(`Node type "${name.trim()}" added to the library`);
      await invalidate.tree();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err), { title: "Could not create the node type" });
    } finally {
      setSaving(false);
    }
  };

  const setAttr = (i, field, value) => setAttrs((list) => list.map((a, j) => (j === i ? { ...a, [field]: value } : a)));

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New node type"
      description="Adds a custom node to the node library so it can be placed in any tree. The robot software must provide a node with the same name."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Plus} onClick={save} loading={saving} disabled={tried && !!invalid}>
            Create node type
          </Button>
        </>
      }
    >
      <div className="bt-form">
        <div className="bt-form-row">
          <Field label="Node name" hint="e.g. CheckBattery, MoveToPose" error={tried ? nameErr : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus invalid={tried && !!nameErr} />
          </Field>
          <Field label="Category" error={tried && cat !== NEW ? catErr : undefined}>
            <Select value={cat} onChange={(e) => setCat(e.target.value)}>
              {(lib?.categories || []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
              <option value={NEW}>+ New category…</option>
            </Select>
          </Field>
        </div>
        {cat === NEW && (
          <Field
            label="New category key"
            hint={category ? `Shown in menus as "${category.charAt(0).toUpperCase() + category.slice(1)}"` : "Lowercase, e.g. sensors, vision"}
            error={tried ? catErr : undefined}
          >
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="sensors" invalid={tried && !!catErr} />
          </Field>
        )}
        <Field label="Node kind" hint={GROUP_HINT[group]}>
          <Segmented
            block
            value={group}
            onChange={(g) => {
              setGroup(g);
              setKind(g === "Control" || g === "Decorator" ? "wrapper" : "leaf");
            }}
            options={CUSTOM_NODE_GROUPS.map((g) => ({ value: g, label: g }))}
          />
        </Field>
        <Field label="Structure">
          <Segmented
            block
            value={kind}
            onChange={setKind}
            options={[
              { value: "leaf", label: "Single step (no children)" },
              { value: "wrapper", label: "Container (holds children)" },
            ]}
          />
        </Field>
        <div className="section-label">Settings (optional)</div>
        {attrs.map((a, i) => (
          <div key={i} className="bt-attr-row">
            <Input size="sm" value={a.k} placeholder="setting name" onChange={(e) => setAttr(i, "k", e.target.value)} />
            <Input size="sm" value={a.v} placeholder="default value" onChange={(e) => setAttr(i, "v", e.target.value)} />
            <IconButton icon={X} size="sm" label="Remove setting" onClick={() => setAttrs((l) => l.filter((_, j) => j !== i))} />
          </div>
        ))}
        {tried && attrErr && <div className="field-error">{attrErr}</div>}
        <div>
          <Button size="sm" icon={Plus} variant="ghost" onClick={() => setAttrs((l) => [...l, { k: "", v: "" }])}>
            Add setting
          </Button>
        </div>
      </div>
    </Modal>
  );
}
