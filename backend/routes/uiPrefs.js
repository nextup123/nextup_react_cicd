// UI preferences shared by every browser that opens this console: panel
// sizes, open tabs, folded sections and the like. The browser keeps a copy
// in localStorage (keys starting with "nextup.") and mirrors changes here,
// so a fresh browser opens with the layout that was last set.
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.NEXTUP_UI_PREFS || path.join(__dirname, "..", "user_config", "ui_prefs.json");
const MAX_VALUE = 64 * 1024;
const MAX_KEYS = 500;
const KEY_RE = /^nextup\.[\w.\-:/]{1,120}$/;

let prefs = null;
let writeTimer = null;

function load() {
  if (prefs) return prefs;
  try {
    prefs = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) prefs = {};
  } catch {
    prefs = {};
  }
  return prefs;
}

/** Writes are coalesced: dragging a splitter sends many small updates. */
function saveSoon() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(prefs, null, 1));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error("[ui-prefs] could not save:", err.message);
    }
  }, 400);
}

const router = express.Router();

router.get("/", (_req, res) => res.json({ prefs: load() }));

/** Body: { set: { key: "string value" }, remove: ["key"] }. */
function patch(req, res) {
  const cur = load();
  const { set = {}, remove = [] } = req.body || {};
  let changed = 0;
  for (const [k, v] of Object.entries(set)) {
    if (!KEY_RE.test(k) || typeof v !== "string" || v.length > MAX_VALUE) continue;
    if (!(k in cur) && Object.keys(cur).length >= MAX_KEYS) continue;
    if (cur[k] !== v) (cur[k] = v), changed++;
  }
  for (const k of Array.isArray(remove) ? remove : []) {
    if (k in cur) delete cur[k], changed++;
  }
  if (changed) saveSoon();
  res.json({ ok: true, changed });
}
router.patch("/", patch);
router.post("/", patch); // navigator.sendBeacon when the page closes

/** Forget every saved layout (back to the defaults). */
router.delete("/", (_req, res) => {
  prefs = {};
  saveSoon();
  res.json({ ok: true });
});

export default router;
