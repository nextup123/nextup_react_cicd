// treeUndo.js
// One-step undo / redo for the Robot Program editor.
//
// Every editing route of /main-tree runs through `undoable` (mainTreeRoutes.js).
// It keeps the editor file's text from before the edit and, once the edit has
// answered OK, the text it left behind. Undo puts the old text back, but only
// while the file still holds exactly what that edit wrote: after a project
// switch or a change made somewhere else there is nothing safe to undo.
// One step only, kept in memory (a backend restart forgets it).

import fs from 'fs/promises';
import { TEMPLATE_PATH } from '../config/path.js';
import { readAndParseXML } from './mainTreeService.js';

const LABELS = {
  '/addSubtree': 'Add subtree',
  '/deleteSubtree': 'Delete subtree',
  '/updateNode': 'Change node settings',
  '/addNode': 'Add node',
  '/addNodeAfter': 'Add node',
  '/deleteNode': 'Delete node',
  '/addSubtreeAsChild': 'Insert subtree',
  '/addDoDiSubtreeAsChild': 'Insert DO/DI subtree',
  '/deleteWrapperOnly': 'Remove container',
  '/addWrapper': 'Wrap node',
  '/swapNodes': 'Move node',
  '/moveNodeAfter': 'Move node',
  '/copyNode': 'Duplicate node',
  '/pasteNode': 'Paste',
};
export const UNDOABLE_ROUTES = Object.keys(LABELS);

let undoStep = null; // { label, before, after }
let redoStep = null; // { label, before, after }  (before = state redo returns to)
let recording = Promise.resolve();
let queue = Promise.resolve(); // edits, undo and redo run one at a time

const readText = () => fs.readFile(TEMPLATE_PATH, 'utf-8').catch(() => null);

async function restore(text) {
  await fs.writeFile(TEMPLATE_PATH, text, 'utf-8');
  await readAndParseXML(TEMPLATE_PATH, true); // refresh the parse cache the editing routes read
}

/** Express middleware for the editing routes. */
export function undoable(req, res, next) {
  const label = LABELS[req.path] || 'Edit';
  let release;
  const gate = new Promise((r) => (release = r));
  const prev = queue;
  queue = gate; // the next edit, undo or redo waits until this edit has been recorded
  prev.then(async () => {
    const before = await readText();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      recording = (async () => {
        if (res.statusCode < 400 && before != null) {
          const after = await readText();
          if (after != null && after !== before) {
            undoStep = { label, before, after };
            redoStep = null;
          }
        }
      })()
        .catch(() => {})
        .finally(release);
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  });
}

async function state() {
  await recording;
  const cur = await readText();
  if (undoStep && cur !== undoStep.after) undoStep = null;
  if (redoStep && cur !== redoStep.before) redoStep = null;
  return { undo: undoStep?.label || null, redo: redoStep?.label || null };
}

const serial = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

// GET /main-tree/undoState → { undo: label | null, redo: label | null }
export const undoStateController = async (req, res) => {
  try {
    res.json(await serial(state));
  } catch (err) {
    res.status(500).send('Could not read the undo state');
  }
};

// POST /main-tree/undo
export const undoController = async (req, res) => {
  try {
    const out = await serial(async () => {
      await state();
      if (!undoStep) return null;
      const step = undoStep;
      await restore(step.before);
      undoStep = null;
      redoStep = { label: step.label, before: step.before, after: step.after };
      return step.label;
    });
    if (!out) return res.status(409).send('Nothing to undo. Only the last change made in the editor can be undone.');
    res.json({ success: true, undone: out });
  } catch (err) {
    console.error('undo error:', err);
    res.status(500).send('Could not undo the last change');
  }
};

// POST /main-tree/redo
export const redoController = async (req, res) => {
  try {
    const out = await serial(async () => {
      await state();
      if (!redoStep) return null;
      const step = redoStep;
      await restore(step.after);
      redoStep = null;
      undoStep = { label: step.label, before: step.before, after: step.after };
      return step.label;
    });
    if (!out) return res.status(409).send('Nothing to redo.');
    res.json({ success: true, redone: out });
  } catch (err) {
    console.error('redo error:', err);
    res.status(500).send('Could not redo the change');
  }
};
