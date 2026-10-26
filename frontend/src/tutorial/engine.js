// Tutorial engine: one lesson at a time, step by step, on the live page.
//
// A lesson is { id, page, title, blurb, setup?(ctx), steps(ctx) → [step] }.
// A step waits for the person to do something on the real page:
//   click: true          advance when the spotlighted element is clicked
//   signal: matcher      advance when the app reports an action (see bus.js)
//   check: (ctx) → bool  advance when the page reaches a state (polled while a lesson runs)
//   press: "Ctrl+F"      advance when that key combination is pressed
//   keys: "Shift+S"      the signal only counts when these keys were used (shortcut practice)
//   (none of these)      an info step with a Next button
// Other step fields: title, text, target (data-tut id, CSS selector or
// (ctx) → element/selector), requires + backTo (go back when the page is no
// longer in the state the step needs, e.g. a menu was closed), group (a
// signal for a later step of the same group jumps there), motion (show the
// robot-moves notice first), onEnter(ctx), tip.
//
// Nothing here can lock the page: the spotlight never blocks clicks and the
// lesson card always has Skip step and Exit.
import { create } from "zustand";
import { onTutSignal } from "./bus";
import { bridge } from "./bridge";

const DONE_KEY = "nextup.tutorials.done";
const SEEN_KEY = "nextup.tutorials.seen";

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const CHEERS = ["Nice!", "Great job!", "Hurray!", "You got it!", "Well done!", "Awesome!", "Perfect!", "Smooth!", "Nailed it!", "Brilliant!"];
const FINALE = ["Lesson complete!", "Hurray, you did it!", "Fantastic work!", "Lesson mastered!"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export const useTutorial = create(() => ({
  lesson: null,
  steps: [],
  index: 0,
  phase: "idle", // idle | intro | preparing | step | done
  ready: false, // motion notice accepted for the current step
  cheer: null, // { text, n }
  nudge: null, // hint after an unexpected action
  error: null,
  finale: "",
  menuOpen: false,
  menuPage: null,
  done: new Set(readJson(DONE_KEY, [])),
  seen: !!readJson(SEEN_KEY, false),
}));

const set = (patch) => useTutorial.setState(patch);
const get = () => useTutorial.getState();

/* ───────────── Context handed to lessons ───────────── */
let navigateFn = null;
export function setNavigate(fn) {
  navigateFn = fn;
}

const mem = { last: {}, keyUsed: false, stepAt: 0, missing: 0 };
export const ctx = {
  bridge,
  mem,
  navigate: (to) => navigateFn?.(to),
  path: () => window.location.pathname,
  /** Last data of a signal (e.g. ctx.lastOf("addNode")?.body.nodeName). */
  lastOf: (tail) => {
    const k = Object.keys(mem.last).reverse().find((n) => n.endsWith(tail));
    return k ? mem.last[k] : null;
  },
};

/* ───────────── Signal matching ───────────── */
/** Matcher for a successful API call; path is matched at its end, without the query. */
export const api = (path, method = "POST", test) => ({ api: path, method, test });

function matches(spec, name, data) {
  if (!spec) return false;
  if (Array.isArray(spec)) return spec.some((s) => matches(s, name, data));
  if (typeof spec === "function") return !!spec(name, data, ctx);
  if (typeof spec === "string") return name === spec;
  if (spec.api) {
    const m = /^api:(\w+) (.*)$/.exec(name);
    if (!m || m[1] !== spec.method) return false;
    const path = m[2].split("?")[0];
    if (!path.endsWith(spec.api)) return false;
    return spec.test ? !!spec.test(data?.body || {}, data?.data, ctx) : true;
  }
  return false;
}

/* ───────────── Keys ───────────── */
const KEY_NAMES = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", " ": "Space", Escape: "Esc", Delete: "Delete", Enter: "Enter" };
/** "Ctrl+Shift+V" style name of a keydown (letters by physical key, so layouts agree with the editor). */
export function comboOf(e) {
  let key = KEY_NAMES[e.key];
  if (!key) {
    const m = /^Key([A-Z])$/.exec(e.code || "");
    key = m ? m[1] : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, key].join("+");
}
const normCombo = (s) => {
  const parts = String(s).split("+").map((p) => p.trim());
  const key = parts.pop();
  const order = ["Ctrl", "Alt", "Shift"];
  return [...order.filter((m) => parts.includes(m)), key.length === 1 ? key.toUpperCase() : key].join("+");
};
const comboList = (k) => (Array.isArray(k) ? k : [k]).map(normCombo);

/* ───────────── Lesson flow ───────────── */
export const current = () => {
  const s = get();
  return s.phase === "step" ? s.steps[s.index] : null;
};

export function openMenu(page = null) {
  set({ menuOpen: true, menuPage: page, seen: true });
  writeJson(SEEN_KEY, true);
}
export const closeMenu = () => set({ menuOpen: false });

export function startLesson(lesson) {
  if (!lesson) return;
  set({ lesson, steps: [], index: 0, phase: "intro", cheer: null, nudge: null, error: null, menuOpen: false, ready: false });
  if (lesson.page && !window.location.pathname.startsWith(lesson.page)) ctx.navigate(lesson.page);
}

export async function begin() {
  const { lesson } = get();
  if (!lesson) return;
  set({ phase: "preparing", error: null });
  mem.last = {};
  try {
    if (lesson.page && !window.location.pathname.startsWith(lesson.page)) ctx.navigate(lesson.page);
    await lesson.setup?.(ctx);
    if (get().lesson !== lesson) return; // exited meanwhile
    const steps = (typeof lesson.steps === "function" ? lesson.steps(ctx) : lesson.steps).filter(Boolean);
    set({ steps, index: 0, phase: "step" });
    enterStep();
  } catch (err) {
    if (get().lesson === lesson) set({ phase: "intro", error: err?.message || "The lesson could not be prepared" });
  }
}

function enterStep() {
  mem.keyUsed = false;
  mem.stepAt = Date.now();
  mem.missing = 0;
  const step = current();
  set({ nudge: null, ready: !step?.motion });
  try {
    step?.onEnter?.(ctx);
  } catch {
    /* ignore */
  }
}

let cheerN = 0;
function goTo(index, { cheer = true } = {}) {
  const { steps, lesson } = get();
  if (!lesson) return;
  if (cheer) set({ cheer: { text: pick(CHEERS), n: ++cheerN } });
  if (index >= steps.length) return finish();
  set({ index: Math.max(0, index) });
  enterStep();
}

export const next = () => goTo(get().index + 1, { cheer: !!current()?.click || !!current()?.signal || !!current()?.check || !!current()?.press });
export const skipStep = () => goTo(get().index + 1, { cheer: false });
export const back = () => goTo(get().index - 1, { cheer: false });
export const acceptMotion = () => set({ ready: true });

function finish() {
  const { lesson, done } = get();
  const nextDone = new Set(done);
  nextDone.add(lesson.id);
  writeJson(DONE_KEY, [...nextDone]);
  set({ phase: "done", done: nextDone, finale: pick(FINALE), nudge: null });
}

export function exitLesson() {
  set({ lesson: null, steps: [], index: 0, phase: "idle", cheer: null, nudge: null, error: null });
}

export function resetProgress(ids) {
  const done = new Set(get().done);
  (ids || [...done]).forEach((id) => done.delete(id));
  writeJson(DONE_KEY, [...done]);
  set({ done });
}

/* ───────────── Events while a lesson runs ───────────── */
function onSignal(name, data) {
  delete mem.last[name]; // newest last
  mem.last[name] = data;
  // keep the memory small
  const keys = Object.keys(mem.last);
  if (keys.length > 40) delete mem.last[keys[0]];
  const { phase, steps, index } = get();
  if (phase !== "step") return;
  const step = steps[index];
  if (!step) return;
  // A later step of the same group may be done already (another way to the same goal).
  let target = -1;
  if (step.group) {
    for (let i = steps.length - 1; i >= index; i--) {
      if (steps[i].group === step.group && steps[i].signal && matches(steps[i].signal, name, data)) {
        target = i;
        break;
      }
    }
  } else if (step.signal && matches(step.signal, name, data)) target = index;
  if (target < 0) return;
  const done = steps[target];
  if (done.keys && !mem.keyUsed) {
    set({ nudge: `That worked, but this time use the keys: ${comboList(done.keys).join(" or ")}` });
    return;
  }
  goTo(target + 1);
}

function onKey(e) {
  const step = current();
  if (!step) return;
  const combo = comboOf(e);
  if (!combo) return;
  if (step.keys && comboList(step.keys).includes(combo)) mem.keyUsed = true;
  if (step.press && comboList(step.press).includes(combo) && get().ready) {
    // let the page handle the key first
    setTimeout(() => current() === step && next(), 60);
  }
}

function onClick(e) {
  const step = current();
  if (!step?.click || !get().ready) return;
  const el = resolveTarget(step);
  if (el && el.contains(e.target)) setTimeout(() => current() === step && next(), 60);
}

/** Called by the host every few hundred ms while a lesson runs. */
export function tick() {
  const step = current();
  if (!step) return;
  if (step.requires && Date.now() - mem.stepAt > 500) {
    let ok = true;
    try {
      ok = !!step.requires(ctx);
    } catch {
      ok = true;
    }
    mem.missing = ok ? 0 : mem.missing + 1;
    if (mem.missing >= 3) {
      const { steps, index } = get();
      const to = typeof step.backTo === "string" ? steps.findIndex((s) => s.id === step.backTo) : index - 1;
      goTo(to < 0 ? index - 1 : to, { cheer: false });
      set({ nudge: "Let's try that again." });
      return;
    }
  }
  if (step.check && get().ready) {
    let ok = false;
    try {
      ok = !!step.check(ctx);
    } catch {
      ok = false;
    }
    if (ok) next();
  }
}

/** Listeners on while a lesson is active; returns the cleanup. */
export function attach() {
  const offSig = onTutSignal(onSignal);
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
  return () => {
    offSig();
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick, true);
  };
}

/* ───────────── Targets ───────────── */
const visible = (el) => {
  if (!el?.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
};

export function findEl(target) {
  if (!target) return null;
  if (typeof target === "function") {
    try {
      return findEl(target(ctx));
    } catch {
      return null;
    }
  }
  if (target instanceof Element) return target;
  if (Array.isArray(target)) {
    for (const t of target) {
      const el = findEl(t);
      if (el) return el;
    }
    return null;
  }
  const sel = /^[\w-]+$/.test(target) ? `[data-tut="${target}"]` : target;
  let list;
  try {
    list = document.querySelectorAll(sel);
  } catch {
    return null;
  }
  for (const el of list) if (visible(el)) return el;
  return null;
}

export const resolveTarget = (step) => findEl(step?.target);
