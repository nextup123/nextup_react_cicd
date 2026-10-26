// Step list: one line per step, dragged to reorder (mouse and touch), with
// the step's motion, target, speeds and problems at a glance.
import { useEffect, useRef } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, CircleAlert, Copy, GripVertical, MessageSquare, Plus, Timer, Trash2 } from "lucide-react";
import { Menu, cx } from "../../components/ui";
import { MOTION_INFO, describeStep, isCartesianPath } from "./programRules";
import { MotionGlyph } from "./glyphs";
import { Tip } from "./Tip";

export const ADD_STEP_ITEMS = [
  { kind: "ptp", label: "Move to a point (PTP)", hint: "travel" },
  { kind: "lin", label: "Straight to a point (LIN)", hint: "approach" },
  { kind: "above", label: "Above a point (PTP + z offset)", hint: "approach" },
  { kind: "retract", label: "Retract up (relative LIN)", hint: "leave" },
  { kind: "arc", label: "Arc through a via point (CIRC)" },
  { kind: "circle", label: "Circle around a centre (CIRCLE)" },
  { kind: "spline", label: "Smooth curve through points (SPLINE)" },
  { kind: "spiral", label: "Spiral around a centre (SPIRAL)" },
  { kind: "weave", label: "Weld seam with weave (LIN)" },
];

function StepRow({ id, step, index, steps, sel, running, issues, onSelect, onDelete, onDuplicate }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const ref = useRef(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  const errs = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warning");
  const blend = Number(step.blend_mm);
  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        ref.current = el;
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx("mp-step", `mot-${step.motion.toLowerCase()}`, sel && "is-sel", isDragging && "is-drag", running && "is-running", errs.length && "has-error")}
      onClick={() => onSelect(index)}
      aria-selected={sel}
      data-tut="mp-step"
      data-tut-step={index}
    >
      <span className="mp-step-grip" data-tut="mp-step-grip" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} aria-label="Drag to reorder">
        <GripVertical size={14} />
      </span>
      <span className="mp-step-i">{index + 1}</span>
      <Tip text={MOTION_INFO[step.motion]?.tip} title={`${step.motion} · ${MOTION_INFO[step.motion]?.name}`}>
        <span className="mp-step-mot">
          <MotionGlyph motion={step.motion} size={16} />
          {step._motionText || step.motion}
        </span>
      </Tip>
      <span className="mp-step-desc">
        <span className="truncate">{describeStep(step)}</span>
        {step.note && (
          <span className="mp-step-note truncate">
            <MessageSquare size={11} /> {step.note}
          </span>
        )}
      </span>
      <span className="mp-step-meta">
        {Number(step.speed_mps) > 0 && <span className="mp-chip" title="Step speed">{step.speed_mps} m/s</span>}
        {Number(step.dwell_s) > 0 && (
          <span className="mp-chip" title="Dwell">
            <Timer size={11} /> {step.dwell_s}s
          </span>
        )}
        {blend > 0 ? (
          <span className="mp-chip is-blend" title={`Rounds this corner with a ${blend} mm radius`}>
            ⤳ {blend}
          </span>
        ) : (
          index < steps.length - 1 && !isCartesianPath(step) && <span className="mp-chip is-stop" title="Stops exactly at this point">stop</span>
        )}
      </span>
      <span className="mp-step-state">
        {errs.length > 0 ? (
          <Tip text={errs.map((e) => e.message).join("\n")}>
            <CircleAlert size={15} className="mp-bad" />
          </Tip>
        ) : warns.length > 0 ? (
          <Tip text={warns.map((e) => e.message).join("\n")}>
            <AlertTriangle size={15} className="mp-warn" />
          </Tip>
        ) : null}
      </span>
      <span className="mp-step-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mp-icon-btn" title="Duplicate (Ctrl+D)" data-tut="mp-step-dup" onClick={() => onDuplicate(index)}>
          <Copy size={13} />
        </button>
        <button type="button" className="mp-icon-btn" title="Delete (Del)" data-tut="mp-step-del" onClick={() => onDelete(index)}>
          <Trash2 size={13} />
        </button>
      </span>
    </li>
  );
}

export default function StepList({ program, sel, runningStep, issuesByStep, onSelect, onMove, onDelete, onDuplicate, onAdd }) {
  const steps = program.steps;
  // stable ids for dnd-kit (index based ids re-created per render are fine as long as they are unique)
  const ids = steps.map((_, i) => `s${i}`);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    onMove(from, to, arrayMove(steps, from, to));
  };
  return (
    <div className="mp-steps-wrap" data-tut="mp-steps">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="mp-steps" role="listbox" aria-label="Steps">
            {steps.map((st, i) => (
              <StepRow
                key={ids[i]}
                id={ids[i]}
                step={st}
                index={i}
                steps={steps}
                sel={sel === i}
                running={runningStep === i}
                issues={issuesByStep[i] || []}
                onSelect={onSelect}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <Menu
        align="left"
        trigger={({ toggle }) => (
          <button type="button" className="mp-add" data-tut="mp-add" onClick={toggle}>
            <Plus size={15} /> Add step {sel >= 0 && sel < steps.length - 1 ? `after ${sel + 1}` : ""}
          </button>
        )}
        items={[{ header: "Add a step" }, ...ADD_STEP_ITEMS.map((it) => ({ label: it.label, hint: it.hint, tut: `mp-add-${it.kind}`, onClick: () => onAdd(it.kind) }))]}
      />
    </div>
  );
}
