// App-wide hover tooltips in the theme colour. Every `title="..."` in the app
// is shown by this one floating card instead of the browser's own tooltip
// (Qt WebEngine draws those black). Titles are moved to data-nx-tip as soon
// as they appear, so the native tooltip never shows; icon-only buttons keep
// the text as their aria-label for screen readers.
const ATTR = "data-nx-tip";
const SHOW_DELAY = 380; // ms before the first tip shows
const SWITCH_WINDOW = 300; // ms: moving to the next item while a tip is up shows it at once

let tipEl = null;
let anchor = null;
let pending = null; // waiting for SHOW_DELAY
let timer = 0;
let lastHide = 0;

function adopt(el) {
  const t = el.getAttribute("title");
  if (t === null) return;
  el.removeAttribute("title");
  if (!t.trim()) {
    el.removeAttribute(ATTR);
    return;
  }
  el.setAttribute(ATTR, t);
  // Name icon-only controls (or keep the name we gave them up to date).
  if (el.hasAttribute("data-nx-aria") || (!el.hasAttribute("aria-label") && !el.textContent.trim())) {
    el.setAttribute("aria-label", t);
    el.setAttribute("data-nx-aria", "");
  }
  if (el === anchor && tipEl) tipEl.textContent = t;
}

function adoptTree(node) {
  if (node.nodeType !== 1) return;
  if (node.hasAttribute("title")) adopt(node);
  if (node.firstElementChild) node.querySelectorAll("[title]").forEach(adopt);
}

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "nx-tip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  return tipEl;
}

function place() {
  if (!anchor || !tipEl) return;
  const a = anchor.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let top = a.bottom + 8;
  if (top + h > window.innerHeight - 6) top = Math.max(6, a.top - h - 8);
  let left = a.left + a.width / 2 - w / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
  tipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function show(el) {
  const text = el.getAttribute(ATTR);
  if (!text || !el.isConnected) return;
  anchor = el;
  const t = ensureEl();
  t.textContent = text;
  t.classList.add("is-on");
  place();
}

function hide() {
  clearTimeout(timer);
  pending = null;
  if (anchor && tipEl?.classList.contains("is-on")) lastHide = Date.now();
  anchor = null;
  tipEl?.classList.remove("is-on");
}

function onOver(e) {
  if (e.pointerType === "touch") return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const titled = target.closest("[title]");
  if (titled) adopt(titled);
  const el = target.closest(`[${ATTR}]`);
  if (el === anchor || (el && el === pending)) return;
  clearTimeout(timer);
  pending = null;
  if (!el) {
    hide();
    return;
  }
  const visible = tipEl?.classList.contains("is-on");
  if (visible || Date.now() - lastHide < SWITCH_WINDOW) {
    hide();
    show(el);
  } else {
    hide();
    pending = el;
    timer = setTimeout(() => {
      pending = null;
      show(el);
    }, SHOW_DELAY);
  }
}

function onOut(e) {
  if (!anchor) {
    if (!e.relatedTarget) clearTimeout(timer);
    return;
  }
  if (e.relatedTarget && anchor.contains(e.relatedTarget)) return;
  if (!e.relatedTarget) hide();
}

export function installThemedTooltips() {
  if (typeof document === "undefined" || installThemedTooltips.done) return;
  installThemedTooltips.done = true;
  adoptTree(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") adopt(m.target);
      else m.addedNodes.forEach(adoptTree);
    }
    // The anchor was removed from the page (dialog closed, list re-rendered).
    if (anchor && !anchor.isConnected) hide();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", hide, true);
  document.addEventListener("wheel", hide, { capture: true, passive: true });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}
