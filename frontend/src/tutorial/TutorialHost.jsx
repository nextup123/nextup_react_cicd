// The lesson on screen: a spotlight ring around the control to use, a
// pointing hand, the lesson card and the little cheers. Everything here is
// see-through for the mouse (pointer-events: none) except the card itself,
// so the page under it always works.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, GraduationCap, Hand, Keyboard, Lightbulb, MousePointerClick, PartyPopper, SkipForward, Star, Trophy, X } from "lucide-react";
import { Button, IconButton, Kbd, Spinner, cx } from "../components/ui";
import { queryClient } from "../lib/queryClient";
import { acceptMotion, attach, back, begin, ctx, exitLesson, findEl, next, openMenu, resolveTarget, setNavigate, skipStep, startLesson, tick, useTutorial } from "./engine";
import { bridge } from "./bridge";
import { allLessons } from "./lessons";
import "./tutorial.css";

const PAD = 6;
const SCROLL_PARENTS = ".bt-ctx-list, .menu, .modal-body, .bt-library-body, .card-scroll, .pp-list, .pm-list-scroll, .bt-lib-list";
const GAP = 16;

/** True when part of el is cut off by the window or by a scrolling panel it sits in. */
function clipped(el) {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) return true;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (!/(auto|scroll)/.test(o.overflowY + o.overflowX)) continue;
    const pr = p.getBoundingClientRect();
    if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.right > pr.right + 1) return true;
  }
  return false;
}

/** True when something (a panel, a dialog) sits over the middle of el. */
function covered(el) {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !hit || !el.contains(hit);
}

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

function Keys({ keys }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <div className="tut-keys">
      <Keyboard size={14} />
      {list.map((k, i) => (
        <span key={k} className="tut-combo">
          {i > 0 && <span className="tut-or">or</span>}
          {k.split("+").map((p, j) => (
            <span key={j} className="tut-combo-part">
              {j > 0 && <span className="tut-plus">+</span>}
              <Kbd>{p}</Kbd>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

const text = (v) => (typeof v === "function" ? v(ctx) : v);

/** Where the card goes: beside the target if there is room, else centred. */
function placeCard(rect, size, centred) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = size.w || 360;
  const h = size.h || 220;
  const clampX = (x) => Math.max(12, Math.min(x, vw - w - 12));
  const clampY = (y) => Math.max(12, Math.min(y, vh - h - 12));
  if (!rect) return centred ? { left: clampX((vw - w) / 2), top: clampY((vh - h) / 2) } : { left: clampX((vw - w) / 2), top: clampY(vh - h - 28) };
  const r = { left: rect.left - PAD, top: rect.top - PAD, right: rect.left + rect.width + PAD, bottom: rect.top + rect.height + PAD };
  const tries = [
    { left: r.right + GAP, top: clampY(r.top), fits: r.right + GAP + w < vw - 8 },
    { left: r.left - GAP - w, top: clampY(r.top), fits: r.left - GAP - w > 8 },
    { left: clampX(r.left), top: r.bottom + GAP, fits: r.bottom + GAP + h < vh - 8 },
    { left: clampX(r.left), top: r.top - GAP - h, fits: r.top - GAP - h > 8 },
  ];
  const t = tries.find((x) => x.fits);
  if (t) return { left: t.left, top: t.top };
  // Big target (a whole panel): sit inside its bottom-right corner.
  // Nothing fits beside it (big target, e.g. a whole dialog): the viewport
  // corner that covers the least of it, so its own buttons stay reachable.
  const corners = [
    { left: 12, top: 12 },
    { left: vw - w - 12, top: 12 },
    { left: 12, top: vh - h - 12 },
    { left: vw - w - 12, top: vh - h - 12 },
  ].map((c) => ({ left: clampX(c.left), top: clampY(c.top) }));
  const overlap = (c) =>
    Math.max(0, Math.min(c.left + w, r.right) - Math.max(c.left, r.left)) * Math.max(0, Math.min(c.top + h, r.bottom) - Math.max(c.top, r.top));
  return corners.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
}

function Confetti() {
  const pieces = Array.from({ length: 46 }, (_, i) => i);
  return (
    <div className="tut-confetti" aria-hidden="true">
      {pieces.map((i) => (
        <span
          key={i}
          style={{
            "--x": `${(i * 37) % 100}vw`,
            "--d": `${(i % 7) * 70}ms`,
            "--r": `${(i * 53) % 360}deg`,
            "--c": `var(--tut-c${i % 5})`,
            "--dx": `${((i * 29) % 40) - 20}vw`,
          }}
        />
      ))}
    </div>
  );
}

export function TutorialHost() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);
  const s = useTutorial();
  const { phase, lesson, steps, index, ready, cheer, nudge } = s;
  const step = phase === "step" ? steps[index] : null;
  const [rect, setRect] = useState(null);
  const [confirmRect, setConfirmRect] = useState(null);
  const [missing, setMissing] = useState(false);
  const [size, setSize] = useState({ w: 360, h: 220 });
  const [drag, setDrag] = useState(null);
  const cardRef = useRef(null);
  const rectRef = useRef(null);
  const missRef = useRef(0);
  const scrolledRef = useRef(null);

  // Listeners and the measuring loop run only while a lesson is open.
  const active = phase !== "idle";
  useEffect(() => {
    if (!active) return;
    const off = attach();
    return off;
  }, [active]);

  useEffect(() => {
    setDrag(null);
    missRef.current = 0;
    setMissing(false);
  }, [index, phase, lesson]);

  useEffect(() => {
    if (!active) return;
    const measure = () => {
      tick();
      const st = useTutorial.getState();
      const cur = st.phase === "step" ? st.steps[st.index] : null;
      // A confirm dialog opened by the step's action gets the light.
      const ok = findEl('[data-tut="confirm-ok"]');
      const cr = ok ? ok.getBoundingClientRect() : null;
      setConfirmRect((p) => (sameRect(p, cr) ? p : cr && { left: cr.left, top: cr.top, width: cr.width, height: cr.height }));
      let el = null;
      if (cur) el = cur.motion && !st.ready ? findEl("estop") : resolveTarget(cur);
      // A target inside a scrolling list (menu, library, dialog), or one cut off
      // by its panel, is scrolled into view once. The tree canvas pans itself.
      // A node on the tree canvas that is hidden (behind the settings panel, or
      // off the canvas) is brought to the middle once.
      const key = el?.closest(".bt-stage") && el.closest("[data-key]")?.getAttribute("data-key");
      if (key && el !== scrolledRef.current && covered(el)) {
        scrolledRef.current = el;
        bridge("tree")?.centerOn?.(key);
      }
      if (el && el !== scrolledRef.current && !el.closest(".bt-stage") && (el.closest(SCROLL_PARENTS) || clipped(el))) {
        scrolledRef.current = el;
        try {
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch {
          /* old browser */
        }
      }
      const r = el ? el.getBoundingClientRect() : null;
      const nr = r && { left: r.left, top: r.top, width: r.width, height: r.height };
      if (!sameRect(rectRef.current, nr)) {
        rectRef.current = nr;
        setRect(nr);
      }
      if (cur?.target && !el && st.ready) {
        missRef.current += 1;
        if (missRef.current === 6) setMissing(true);
      } else if (missRef.current) {
        missRef.current = 0;
        setMissing(false);
      }
    };
    measure();
    const id = setInterval(measure, 200);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (Math.abs(w - size.w) > 2 || Math.abs(h - size.h) > 2) setSize({ w, h });
  });

  if (!active || !lesson) return null;

  const spot = confirmRect || (step ? rect : null);
  const centred = phase !== "step" || (!step?.target && !(step?.motion && !ready));
  const base = placeCard(phase === "step" ? spot : null, size, centred);
  const pos = drag ? { left: base.left + drag.dx, top: base.top + drag.dy } : base;
  const dim = phase !== "step" || !!spot || !step?.target;
  const total = steps.length;
  const waiting = step && (step.click || step.signal || step.check || step.press);

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const x0 = e.clientX - (drag?.dx || 0);
    const y0 = e.clientY - (drag?.dy || 0);
    const move = (ev) => setDrag({ dx: ev.clientX - x0, dy: ev.clientY - y0 });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const lessons = phase === "done" ? allLessons(queryClient.getQueryData(["tree", "node-types"])) : [];
  const pageLessons = lessons.filter((l) => l.page === lesson.page);
  const pageDone = pageLessons.filter((l) => s.done.has(l.id)).length;
  const at = pageLessons.findIndex((l) => l.id === lesson.id);
  const nextLesson = pageLessons.slice(at + 1).find((l) => !s.done.has(l.id)) || pageLessons.find((l) => !s.done.has(l.id) && l.id !== lesson.id);

  return createPortal(
    <div className="tut-layer" data-phase={phase}>
      {dim && !spot && <div className="tut-dim" />}
      {spot && (
        <svg className="tut-mask" aria-hidden="true">
          <defs>
            <mask id="tut-hole">
              <rect width="100%" height="100%" fill="#fff" />
              <rect className="tut-hole" x={spot.left - PAD} y={spot.top - PAD} width={spot.width + PAD * 2} height={spot.height + PAD * 2} rx="10" fill="#000" />
            </mask>
          </defs>
          <rect className="tut-mask-fill" width="100%" height="100%" mask="url(#tut-hole)" />
        </svg>
      )}
      {spot && (
        <div
          className={cx("tut-spot", confirmRect && "is-confirm", step?.motion && !ready && "is-danger")}
          style={{ left: spot.left - PAD, top: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2 }}
        >
          {(confirmRect || waiting || (step?.motion && !ready)) && (
            <span className="tut-hand">{step?.keys && !confirmRect ? <Keyboard size={22} /> : step?.click || confirmRect ? <MousePointerClick size={22} /> : <Hand size={22} />}</span>
          )}
          {confirmRect && <span className="tut-spot-label">Confirm here</span>}
        </div>
      )}

      {cheer && <div key={cheer.n} className="tut-cheer"><Star size={18} /> {cheer.text}</div>}
      {phase === "done" && <Confetti />}

      <div
        ref={cardRef}
        className={cx("tut-card", phase === "done" && "is-done")}
        style={{ left: pos.left, top: pos.top }}
        role="dialog"
        aria-label={`Tutorial: ${lesson.title}`}
        // Give the keyboard back to the page after a click on the card, so the
        // next shortcut goes to the page and not to a card button.
        onClick={() => setTimeout(() => cardRef.current?.contains(document.activeElement) && document.activeElement.blur(), 0)}
      >
        <div className="tut-card-head" onPointerDown={startDrag} title="Drag to move">
          <span className="tut-badge"><GraduationCap size={15} /></span>
          <span className="tut-lesson truncate">{lesson.title}</span>
          {phase === "step" && <span className="tut-count">{index + 1}/{total}</span>}
          <IconButton icon={X} size="sm" label="Exit the tutorial" onClick={exitLesson} />
        </div>
        {phase === "step" && (
          <div className="tut-progress"><span style={{ width: `${(index / Math.max(1, total)) * 100}%` }} /></div>
        )}

        {phase === "intro" && (
          <div className="tut-body">
            <div className="tut-title">{lesson.title}</div>
            <p className="tut-text">{lesson.blurb}</p>
            {lesson.learn?.length > 0 && (
              <ul className="tut-learn">
                {lesson.learn.map((l) => (
                  <li key={l}><Star size={12} /> {l}</li>
                ))}
              </ul>
            )}
            {lesson.motion && (
              <div className="tut-warn"><AlertTriangle size={16} /> <span>In this lesson the robot moves. Keep the area around it clear and keep the E-STOP within reach.</span></div>
            )}
            {lesson.note && <div className="tut-tip"><Lightbulb size={14} /> <span>{text(lesson.note)}</span></div>}
            {s.error && <div className="tut-nudge is-error">{s.error}</div>}
            <div className="tut-actions">
              <Button variant="ghost" onClick={exitLesson}>Not now</Button>
              <span className="spacer" />
              <Button variant="primary" iconRight={ArrowRight} onClick={begin}>Let's go</Button>
            </div>
          </div>
        )}

        {phase === "preparing" && (
          <div className="tut-body tut-preparing"><Spinner /> Getting the page ready…</div>
        )}

        {phase === "step" && step && (
          <div className="tut-body">
            {step.title && <div className="tut-title">{text(step.title)}</div>}
            {step.motion && !ready ? (
              <>
                <div className="tut-warn"><AlertTriangle size={16} /> <span>{text(step.motion === true ? "The next step moves the robot. Keep the area clear. The red E-STOP in the top bar stops it at once." : step.motion)}</span></div>
                <div className="tut-actions">
                  <Button variant="ghost" icon={SkipForward} onClick={skipStep}>Skip step</Button>
                  <span className="spacer" />
                  <Button variant="warning" onClick={acceptMotion}>I'm ready</Button>
                </div>
              </>
            ) : (
              <>
                <div className="tut-text">{text(step.text)}</div>
                {step.list && (
                  <ul className="tut-list">
                    {step.list.map((l, i) => (
                      <li key={l}>
                        {step.swatches?.[i] && <i style={{ background: step.swatches[i] }} />}
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {step.keys && <Keys keys={step.keys} />}
                {step.press && !step.keys && <Keys keys={step.press} />}
                {step.tip && <div className="tut-tip"><Lightbulb size={14} /> <span>{text(step.tip)}</span></div>}
                {nudge && <div className="tut-nudge">{nudge}</div>}
                {missing && (
                  <div className="tut-nudge">{text(step.missing) || "Can't find it on the screen right now. Scroll, open the panel it lives in, or skip this step."}</div>
                )}
                <div className="tut-actions">
                  {index > 0 && <IconButton icon={ArrowLeft} size="sm" label="Back one step" onClick={back} />}
                  <Button variant="ghost" size="sm" icon={SkipForward} onClick={skipStep}>Skip step</Button>
                  <span className="spacer" />
                  {waiting ? (
                    <span className="tut-waiting"><span className="tut-pulse" /> Your turn</span>
                  ) : (
                    <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={next}>{index === total - 1 ? "Finish" : "Next"}</Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="tut-body tut-finale">
            <div className="tut-trophy"><Trophy size={34} /></div>
            <div className="tut-stars"><Star size={22} /><Star size={28} /><Star size={22} /></div>
            <div className="tut-title">{s.finale}</div>
            <p className="tut-text">{lesson.outro || `You finished "${lesson.title}".`}</p>
            {pageLessons.length > 0 && (
              <div className="tut-page-progress">
                <PartyPopper size={14} /> {pageDone} of {pageLessons.length} lessons done on this page
                <div className="tut-progress is-wide"><span style={{ width: `${(pageDone / pageLessons.length) * 100}%` }} /></div>
              </div>
            )}
            <div className="tut-actions">
              <Button variant="ghost" onClick={exitLesson}>Close</Button>
              <Button onClick={() => { exitLesson(); openMenu(lesson.page); }}>All lessons</Button>
              <span className="spacer" />
              {nextLesson && (
                <Button variant="primary" iconRight={ArrowRight} onClick={() => startLesson(nextLesson)} title={nextLesson.title}>
                  Next lesson
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
