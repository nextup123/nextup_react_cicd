// One form for "New project", "Copy project" and "Save as": name, owner,
// optional project type and description.
import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Segmented, Textarea } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { validateName } from "./projectsApi";

const TYPES = [
  { value: "standard", label: "Standard template" },
  { value: "blank", label: "Blank" },
];

/**
 * form: null (closed) or { title, description, submitLabel, defaults: {name, owner, description, project_type},
 *        showType, note, onSubmit: async (values) => void }
 */
export function ProjectFormModal({ form, projects, onClose }) {
  const [values, setValues] = useState({ name: "", owner: "", description: "", project_type: "standard" });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!form) return;
    setValues({ name: "", owner: "", description: "", project_type: "standard", ...form.defaults });
    setTouched(false);
    setError(null);
    setBusy(false);
  }, [form]);

  if (!form) return null;
  const nameError = validateName(values.name, projects);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e?.preventDefault();
    setTouched(true);
    if (nameError) return;
    setBusy(true);
    setError(null);
    try {
      await form.onSubmit({
        name: values.name.trim(),
        owner: values.owner.trim(),
        description: values.description.trim(),
        project_type: values.project_type,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      tut="project-form"
      className="pm-modal"
      onClose={onClose}
      title={form.title}
      description={form.description}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={touched && !!nameError} title={touched && nameError ? nameError : undefined}>
            {form.submitLabel}
          </Button>
        </>
      }
    >
      <form className="pm-form" onSubmit={submit}>
        <Field label="Project name" error={touched ? nameError : null} hint="Used as the folder name on the robot">
          <Input autoFocus value={values.name} onChange={set("name")} onBlur={() => setTouched(true)} placeholder="e.g. Welding_Cell_A" invalid={touched && !!nameError} />
        </Field>
        <Field label="Owner" hint="Leave empty to use the default owner">
          <Input value={values.owner} onChange={set("owner")} placeholder="Your name" />
        </Field>
        {form.showType && (
          <Field label="Start from" hint="Standard fills the project with the default configuration files; Blank creates empty files.">
            <Segmented options={TYPES} value={values.project_type} onChange={set("project_type")} block />
          </Field>
        )}
        <Field label="Description">
          <Textarea rows={3} value={values.description} onChange={set("description")} placeholder="What is this project about?" />
        </Field>
        {form.note && <Alert tone="info">{form.note}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
