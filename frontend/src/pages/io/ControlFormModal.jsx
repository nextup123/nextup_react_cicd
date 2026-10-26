import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Field, Input, Loading, Modal, Segmented, Select, Alert } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { toast } from "../../store/toast";
import { useRobot } from "../../store/robot";
import { fetchControl, ioAction, splitName } from "./ioApi";

const DRIVERS = ["1", "2", "3", "4", "5", "6"];
const DRIVER_DO_IDS = [
  { value: "1", label: "DO1" },
  { value: "2", label: "DO2" },
  { value: "3", label: "DO3" },
  { value: "pi_p", label: "PI_P" },
];
const DRIVER_DI_IDS = ["1", "2", "3", "4", "5"];
const GPIO_CHANNELS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const DEFAULT_GPIO_GROUPS = ["gpio1", "gpio2", "gpio3"];
const NAME_RE = /^[A-Za-z0-9]+$/;

const EMPTY = {
  source: "driver", // driver | gpio
  kind: "do", // do | di
  name: "",
  driverId: "1",
  gpioId: "gpio1",
  doId: "1",
  diId: "1",
  controlType: "switch",
  pushWait: "250",
  waitEnabled: false,
  waitTime: "250",
  fallback: false,
  responseMsg: "",
};

const typeOf = (source, kind) =>
  source === "gpio" ? (kind === "do" ? "GpioDoControl" : "GpioDiControl") : kind === "do" ? "DO" : "DI";

/** Keep `value` selectable even when it is outside the default list (edit of older data). */
const withValue = (list, value) => {
  const opts = list.map((o) => (typeof o === "object" ? o : { value: o, label: o }));
  if (value && !opts.some((o) => o.value === String(value))) opts.push({ value: String(value), label: String(value) });
  return opts;
};

function msInRange(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 1000;
}

/**
 * Add / edit one IO control sequence.
 * `target`: null (closed) | { mode: "add", source, kind } | { mode: "edit", name, type }
 */
export default function ControlFormModal({ target, onClose, existingNames }) {
  const editing = target?.mode === "edit";
  const [form, setForm] = useState(EMPTY);
  const [suffix, setSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const gpioGroupsLive = useRobot((s) => Object.keys(s.gpio).join("|"));

  useEffect(() => {
    if (!target) return;
    setTouched(false);
    setLoadError("");
    if (target.mode === "add") {
      setForm({ ...EMPTY, source: target.source || "driver", kind: target.kind || "do" });
      setSuffix("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchControl(target.name)
      .then((d) => {
        if (cancelled) return;
        const isGpio = d.type === "GpioDoControl" || d.type === "GpioDiControl";
        const kind = d.type === "DO" || d.type === "GpioDoControl" ? "do" : "di";
        const { base, suffix: sfx } = splitName(d.name);
        setSuffix(sfx);
        setForm({
          ...EMPTY,
          source: isGpio ? "gpio" : "driver",
          kind,
          name: base,
          driverId: d.driverId ? String(d.driverId) : "1",
          gpioId: d.gpioId ? String(d.gpioId) : "gpio1",
          doId: d.doId ? String(d.doId) : "1",
          diId: d.diId ? String(d.diId) : "1",
          controlType: d.controlType || "switch",
          pushWait: d.pushWait ? String(d.pushWait) : "250",
          waitEnabled: Boolean(d.waitTime),
          waitTime: d.waitTime ? String(d.waitTime) : "250",
          fallback: Boolean(d.with_fallback),
          responseMsg: d.responseMsg || "",
        });
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err, "Could not load this sequence")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isDo = form.kind === "do";
  const isGpio = form.source === "gpio";
  const isPiP = !isGpio && isDo && form.doId === "pi_p";
  const finalSuffix = editing ? suffix : isDo ? "[DO]" : "[DI]";
  const fullName = `${form.name.trim()}${finalSuffix}`;

  const errors = useMemo(() => {
    const e = {};
    const name = form.name.trim();
    if (!name) e.name = "Enter a name";
    else if (!NAME_RE.test(name)) e.name = "Letters and digits only, no spaces or symbols";
    else if (existingNames.includes(fullName) && !(editing && fullName === target?.name)) e.name = `“${fullName}” already exists`;
    if (isGpio && !form.gpioId.trim()) e.gpioId = "Choose a GPIO group";
    if (isDo && form.controlType === "push" && !msInRange(form.pushWait)) e.pushWait = "100 – 1000 ms";
    if (!isDo && form.waitEnabled && !msInRange(form.waitTime)) e.waitTime = "100 – 1000 ms";
    if (!form.responseMsg.trim()) e.responseMsg = "Enter the message to log";
    return e;
  }, [form, isGpio, isDo, existingNames, fullName, editing, target]);
  const valid = Object.keys(errors).length === 0;
  const err = (k) => (touched ? errors[k] : undefined);

  const submit = async (e) => {
    e?.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    const type = typeOf(form.source, form.kind);
    const body = {
      type,
      name: fullName,
      responseMsg: form.responseMsg.trim(),
      ...(isGpio ? { gpioId: form.gpioId.trim() } : { driverId: form.driverId }),
      ...(isDo
        ? {
            doId: form.doId,
            controlType: isPiP ? "switch" : form.controlType,
            pushWait: form.controlType === "push" && !isPiP ? String(form.pushWait) : "250",
          }
        : {
            diId: form.diId,
            waitTime: form.waitEnabled ? String(form.waitTime) : null,
            with_fallback: form.fallback,
          }),
      ...(editing ? { oldName: target.name } : {}),
    };
    setSaving(true);
    try {
      const msg = await ioAction(editing ? "updateControl" : "addControl", body);
      toast.success(msg);
      onClose();
    } catch (err2) {
      toast.error(errorMessage(err2, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const gpioGroupOptions = withValue(
    [...new Set([...DEFAULT_GPIO_GROUPS, ...(gpioGroupsLive ? gpioGroupsLive.split("|") : [])])],
    form.gpioId
  );

  const title = editing
    ? `Edit ${target?.name || ""}`
    : `Add ${isGpio ? "GPIO" : "driver"} ${isDo ? "output" : "input"} step`;

  return (
    <Modal
      tut="io-form"
      open={Boolean(target)}
      onClose={onClose}
      title={title}
      description={
        isDo
          ? "Sets a digital output from the robot program. The program decides on/off when the step runs."
          : "Checks a digital input from the robot program (expected state is given by the program)."
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={loading || Boolean(loadError) || (touched && !valid)}>
            {editing ? "Save changes" : isDo ? "Add output step" : "Add input step"}
          </Button>
        </>
      }
    >
      {loading ? (
        <Loading label="Loading sequence…" />
      ) : loadError ? (
        <Alert tone="danger" title="Could not load">{loadError}</Alert>
      ) : (
        <form className="io-form" onSubmit={submit}>
          <div className="io-form-switches">
            <Field label="Connected to">
              <Segmented
                block
                value={form.source}
                disabled={editing}
                onChange={(v) => set({ source: v })}
                options={[
                  { value: "driver", label: "Joint driver" },
                  { value: "gpio", label: "GPIO module" },
                ]}
              />
            </Field>
            <Field label="Signal">
              <Segmented
                block
                value={form.kind}
                disabled={editing}
                onChange={(v) => set({ kind: v })}
                options={[
                  { value: "do", label: "Output (DO)" },
                  { value: "di", label: "Input (DI)" },
                ]}
              />
            </Field>
          </div>

          <div className="form-grid">
            <Field
              label="Name"
              error={err("name")}
              hint={form.name.trim() && NAME_RE.test(form.name.trim()) ? `Saved as “${fullName}”` : "Letters and digits only, e.g. gripper1"}
            >
              <Input
                autoFocus
                value={form.name}
                invalid={Boolean(err("name"))}
                placeholder="e.g. gripper1"
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>

            {isGpio ? (
              <Field label="GPIO group" error={err("gpioId")}>
                <Select value={form.gpioId} onChange={(e) => set({ gpioId: e.target.value })} options={gpioGroupOptions} />
              </Field>
            ) : (
              <Field label="Driver">
                <Select
                  value={form.driverId}
                  onChange={(e) => set({ driverId: e.target.value })}
                  options={DRIVERS.map((d) => ({ value: d, label: `Driver ${d} (joint ${d})` }))}
                />
              </Field>
            )}

            {isDo ? (
              <>
                <Field label={isGpio ? "Output channel" : "Output"}>
                  <Select
                    value={form.doId}
                    onChange={(e) => {
                      const doId = e.target.value;
                      set({ doId, ...(doId === "pi_p" && !isGpio ? { controlType: "switch" } : {}) });
                    }}
                    options={withValue(isGpio ? GPIO_CHANNELS.map((c) => ({ value: c, label: `DO${c}` })) : DRIVER_DO_IDS, form.doId)}
                  />
                </Field>
                <Field label="Control type" hint={isPiP ? "PI_P only supports switch" : form.controlType === "push" ? "Turns on, waits, then turns off" : "Stays on or off"}>
                  <Segmented
                    block
                    value={isPiP ? "switch" : form.controlType}
                    onChange={(v) => set({ controlType: v })}
                    options={[
                      { value: "switch", label: "Switch" },
                      { value: "push", label: "Push", disabled: isPiP, title: isPiP ? "PI_P only supports switch" : undefined },
                    ]}
                  />
                </Field>
                <Field label="Push time (ms)" error={err("pushWait")} hint={form.controlType === "push" && !isPiP ? "How long the output stays on, 100 – 1000 ms" : "Only used for push"}>
                  <Input
                    type="number"
                    min={100}
                    max={1000}
                    step={50}
                    value={form.pushWait}
                    disabled={form.controlType !== "push" || isPiP}
                    title={form.controlType !== "push" || isPiP ? "Only used when the control type is Push" : undefined}
                    invalid={Boolean(err("pushWait"))}
                    onChange={(e) => set({ pushWait: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={isGpio ? "Input channel" : "Input"}>
                  <Select
                    value={form.diId}
                    onChange={(e) => set({ diId: e.target.value })}
                    options={withValue((isGpio ? GPIO_CHANNELS : DRIVER_DI_IDS).map((c) => ({ value: c, label: `DI${c}` })), form.diId)}
                  />
                </Field>
                <Field label="Wait time (ms)" error={err("waitTime")} hint="100 – 1000 ms (wait_time)">
                  <div className="io-inline">
                    <Checkbox label="Use" checked={form.waitEnabled} onChange={(v) => set({ waitEnabled: v })} />
                    <Input
                      type="number"
                      min={100}
                      max={1000}
                      step={50}
                      value={form.waitTime}
                      disabled={!form.waitEnabled}
                      title={!form.waitEnabled ? "Tick “Use” to set a wait time" : undefined}
                      invalid={Boolean(err("waitTime"))}
                      onChange={(e) => set({ waitTime: e.target.value })}
                    />
                  </div>
                </Field>
                <Field label="When the input check fails" hint="Fallback: shows a “sensing failed” popup, logs it and fails the step">
                  <Checkbox label="Show failure popup (fallback)" checked={form.fallback} onChange={(v) => set({ fallback: v })} />
                </Field>
              </>
            )}

            <Field span2 label="Log message" error={err("responseMsg")} hint="Written to the robot log when the step completes">
              <Input
                value={form.responseMsg}
                placeholder="e.g. Gripper closed"
                invalid={Boolean(err("responseMsg"))}
                onChange={(e) => set({ responseMsg: e.target.value })}
              />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
