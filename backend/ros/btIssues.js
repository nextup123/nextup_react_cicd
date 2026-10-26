// backend/ros/btIssues.js
//
// Turns the runner's validation text ("file.xml:LINE Node 'name': what is
// wrong", see control_logic_bt tree_validator.cpp) into issues the UI can
// point at:
//   tree   the <BehaviorTree ID> that holds the node (the editor's subtree)
//   idx    child-index path inside that BehaviorTree as the editor's tree
//          model numbers nodes ("" = the BehaviorTree itself, "0" = its first
//          node, "0.2" = that node's third child)
//   paths  child-index paths from the root of the RUNNING tree, one per place
//          the node appears once every SubTree is expanded (a subtree used
//          twice gives two paths); the runner page walks its structure with them
// The tree files are read again here (they are small), with line numbers.

import fs from 'fs';
import path from 'path';
import xmldom from 'xmldom';

const { DOMParser } = xmldom;

const SUBTREES = /^(SubTree|SubTreePlus)$/;
const MAX_EXPANDED = 20000;
const MAX_PATHS = 24;

const elementChildren = (el) => {
  const out = [];
  for (let c = el?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
};

/** "main_tree.xml:42 MoveL 'pick': speed must be ..." → { file, line, label, text } */
export function parseIssue(s) {
  const str = String(s ?? '');
  const m = /^([^\s:]+\.xml)(?::(\d+))?(?: (.+?))?: ([\s\S]*)$/i.exec(str);
  if (!m) return { file: '', line: 0, label: '', text: str };
  return { file: m[1], line: Number(m[2] || 0), label: m[3] || '', text: m[4] };
}

/** Node label → { type, name }: "MoveL 'pick'" · "'pick'" · "MoveL". */
function splitLabel(label) {
  const m = /^(?:([^\s']+)\s*)?(?:'([^']*)')?$/.exec(label || '');
  if (!m) return { type: label || '', name: '' };
  return { type: m[1] || '', name: m[2] || '' };
}

/** Every file reachable from `mainFile` (includes followed), parsed with line numbers. */
function readFiles(mainFile) {
  const docs = [];
  const seen = new Set();
  const visit = (f) => {
    const abs = path.resolve(f);
    if (seen.has(abs) || !fs.existsSync(abs)) return;
    seen.add(abs);
    let doc = null;
    try {
      doc = new DOMParser({ locator: {}, errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } }).parseFromString(fs.readFileSync(abs, 'utf8'), 'text/xml');
    } catch {
      return;
    }
    const root = doc?.documentElement;
    if (!root) return;
    docs.push({ file: abs, base: path.basename(abs), root });
    for (const el of elementChildren(root)) {
      if (el.nodeName === 'include') {
        const p = el.getAttribute('path');
        if (p && !el.getAttribute('ros_pkg')) visit(path.isAbsolute(p) ? p : path.join(path.dirname(abs), p));
      }
    }
  };
  visit(mainFile);
  return docs;
}

/** Index of every node element: file, line, enclosing BehaviorTree, idx path. */
function indexFiles(docs) {
  const all = []; // { el, base, line, tag, id, name, tree, idx }
  const trees = new Map(); // BehaviorTree ID → element
  for (const d of docs) {
    for (const bt of elementChildren(d.root)) {
      if (bt.nodeName !== 'BehaviorTree') continue;
      const id = bt.getAttribute('ID') || '';
      if (id && !trees.has(id)) trees.set(id, bt);
      all.push({ el: bt, base: d.base, line: bt.lineNumber || 0, tag: 'BehaviorTree', id, name: id, tree: id, idx: '' });
      const walk = (el, idx) => {
        all.push({ el, base: d.base, line: el.lineNumber || 0, tag: el.nodeName, id: el.getAttribute('ID') || '', name: el.getAttribute('name') || '', tree: id, idx });
        elementChildren(el).forEach((c, i) => walk(c, `${idx}.${i}`));
      };
      elementChildren(bt).forEach((c, i) => walk(c, `${i}`)); // the editor numbers the BehaviorTree "" and its nodes "0", "0.1", ...
    }
  }
  return { all, trees };
}

/** element → child-index paths in the running (expanded) tree. */
function expand(mainId, trees) {
  const paths = new Map();
  let count = 0;
  const add = (el, p) => {
    const list = paths.get(el);
    if (!list) paths.set(el, [p]);
    else if (list.length < MAX_PATHS) list.push(p);
  };
  const walk = (el, p, stack) => {
    if (++count > MAX_EXPANDED) return;
    add(el, p);
    if (SUBTREES.test(el.nodeName)) {
      const id = el.getAttribute('ID');
      const def = id && trees.get(id);
      if (!def || stack.includes(id)) return;
      const inner = elementChildren(def)[0];
      if (inner) walk(inner, p === '' ? '0' : `${p}.0`, [...stack, id]);
      return;
    }
    elementChildren(el).forEach((c, i) => walk(c, p === '' ? `${i}` : `${p}.${i}`, stack));
  };
  const main = trees.get(mainId);
  const top = main && elementChildren(main)[0];
  if (top) walk(top, '', [mainId]);
  return paths;
}

/**
 * Adds `issues` to a validation result: errors first, then warnings, each with
 * where its node is. opts: { mainFile, editorFile } (absolute / base name).
 */
export function locateIssues(result, { mainFile, editorFile = '' } = {}) {
  const raw = [
    ...(result?.errors || []).map((s) => ({ error: true, s })),
    ...(result?.warnings || []).map((s) => ({ error: false, s })),
  ];
  if (!raw.length) return { ...result, issues: [] };
  let idx = { all: [], trees: new Map() };
  let paths = new Map();
  try {
    const docs = readFiles(mainFile);
    idx = indexFiles(docs);
    const mainDoc = docs[0]?.root;
    let mainId = mainDoc?.getAttribute('main_tree_to_execute') || '';
    if (!mainId || !idx.trees.has(mainId)) mainId = idx.trees.has('MainTree') ? 'MainTree' : idx.trees.keys().next().value || '';
    paths = expand(mainId, idx.trees);
  } catch {
    /* unreadable files: the issues keep their text, without a node */
  }
  const editorBase = editorFile ? path.basename(editorFile) : '';

  const issues = raw.map(({ error, s }) => {
    const p = parseIssue(s);
    const { type, name } = splitLabel(p.label);
    let hit = null;
    if (p.file) {
      const inFile = idx.all.filter((e) => e.base === p.file);
      const atLine = p.line > 0 ? inFile.filter((e) => e.line === p.line) : [];
      const fits = (e) => (name ? e.name === name || (!e.name && e.id === name) : type ? e.tag === type || e.id === type || e.name === type : true);
      hit = atLine.find(fits) || atLine.find((e) => e.tag !== 'BehaviorTree' && e.tag !== 'include' && e.tag !== 'root') || (name ? inFile.find((e) => e.name === name) : null) || null;
      if (hit && (hit.tag === 'include' || hit.tag === 'root')) hit = null;
    }
    if (!hit && name) hit = idx.all.find((e) => e.name === name) || null;
    const where = hit
      ? {
          tree: hit.tree,
          idx: hit.idx,
          name: hit.name || hit.id || hit.tag,
          type: hit.tag === 'Action' || hit.tag === 'Condition' || hit.tag === 'Control' || hit.tag === 'Decorator' ? hit.id || hit.tag : hit.tag,
          paths: paths.get(hit.el) || [],
          inEditor: Boolean(editorBase) && hit.base === editorBase,
        }
      : { tree: '', idx: null, name: name || type || '', type: type || '', paths: [], inEditor: false };
    return { error, text: p.text, label: p.label, line: p.line, file: p.file, ...where };
  });
  return { ...result, issues };
}
