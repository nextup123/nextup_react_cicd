// backend/ros/programStore.js
//
// programs.yaml (motion programs of nextup_motion_server) read and written
// for the Motion Programs page. The file is edited as a YAML document, not
// re-dumped: saving one program replaces only that program's entry, so the
// comments, the order and every other program stay exactly as they were.
// A step's trailing comment ("# 80 mm above pick") is its `note`.
//
// Writes are atomic (temp file + fsync + rename) and keep the previous
// version as programs.yaml.bak, like the motion server does itself. The
// server re-reads the file on every call, so a save needs no restart.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { normalizeProgram, programToYaml, checkProgram, checkProgramList, NAME_RE } from './programRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Starter file of a new project (also used by "Create programs.yaml"). */
export const DEFAULT_PROGRAMS_FILE = path.resolve(__dirname, '../user_config/pm_defaults/programs.yaml');

const STRINGIFY = { lineWidth: 0, flowCollectionPadding: false, indentSeq: true };
const HEADER =
  ' Motion programs (nextup_motion_server ~/run_program). Motion only: the BT does logic and I/O.\n' +
  ' motion: PTP | LIN | CIRC | CIRCLE | SPLINE | SPIRAL; units mm, deg, s, m/s, m/s2.\n' +
  ' Edited with the web UI (Motion Programs); comments next to steps are kept.';

async function readText(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function parse(text) {
  const doc = YAML.parseDocument(text ?? '', { keepSourceTokens: false });
  if (doc.errors?.length) {
    const e = doc.errors[0];
    const where = e.linePos?.[0] ? ` (line ${e.linePos[0].line})` : '';
    const err = new Error(`programs.yaml is not valid YAML${where}: ${e.message.split('\n')[0]}`);
    err.code = 'YAML_PARSE';
    throw err;
  }
  return doc;
}

/** The programs collection node: a sequence (entries with name) or a map (key = name). */
function programsNode(doc) {
  const node = doc.get('programs', true);
  if (node === undefined || node === null) return null;
  if (YAML.isSeq(node) || YAML.isMap(node)) return node;
  const err = new Error("programs.yaml: 'programs' must be a list or a map");
  err.code = 'YAML_SHAPE';
  throw err;
}

/** [{ node, keyNode?, name, raw }] in file order. */
function entries(doc) {
  const coll = programsNode(doc);
  if (!coll) return [];
  if (YAML.isSeq(coll)) {
    return coll.items.map((node, index) => {
      const raw = YAML.isNode(node) ? node.toJSON() : node;
      return { node, index, name: String(raw?.name ?? ''), raw };
    });
  }
  return coll.items.map((pair, index) => {
    const key = YAML.isScalar(pair.key) ? pair.key.value : pair.key;
    const raw = YAML.isNode(pair.value) ? pair.value.toJSON() : pair.value;
    return { node: pair.value, pair, index, name: String(raw?.name ?? key ?? ''), raw, keyName: String(key ?? '') };
  });
}

const clean = (s) => (s ? String(s).replace(/^\s+/gm, '').trim() : '');

/** Program JSON for the browser: normalized keys, step notes from the YAML comments. */
function toProgram(entry) {
  const p = normalizeProgram(entry.raw || {}, entry.keyName || '');
  p.comment = clean(entry.node?.commentBefore || entry.pair?.key?.commentBefore);
  const steps = YAML.isMap(entry.node) ? entry.node.get('steps', true) : null;
  if (YAML.isSeq(steps)) {
    steps.items.forEach((s, i) => {
      if (p.steps[i]) p.steps[i].note = clean(s?.comment);
    });
  }
  return p;
}

/**
 * Read the file. Never throws for a missing file (exists: false) or a file
 * that does not parse (parseError set, programs empty); the page shows both.
 */
export async function readPrograms(file, pointsIdx = null) {
  const text = await readText(file);
  if (text === null) return { exists: false, file, programs: [], problems: [], text: '' };
  let doc;
  try {
    doc = parse(text);
    programsNode(doc);
  } catch (err) {
    return { exists: true, file, programs: [], problems: [], text, parseError: err.message };
  }
  const programs = entries(doc).map(toProgram);
  const problems = [];
  for (const d of checkProgramList(programs)) problems.push({ program: d.name, level: 'warning', step: null, message: d.message });
  for (const p of programs) {
    for (const i of checkProgram(p, { points: pointsIdx || undefined })) {
      problems.push({ program: p.name, level: i.level, step: i.step, field: i.field, message: i.message });
    }
  }
  return { exists: true, file, programs, problems, text };
}

/** YAML node for one program: block map, steps as one flow map per line (like the examples). */
function programNode(doc, program, old) {
  const node = doc.createNode(programToYaml(program));
  const steps = node.get('steps', true);
  if (YAML.isSeq(steps)) {
    steps.items.forEach((item, i) => {
      item.flow = true;
      const note = program.steps[i]?.note;
      if (note) item.comment = ` ${String(note).replace(/\s*\n\s*/g, ' ').trim()}`;
    });
  }
  // keep the comment above the program and comments on its own keys
  if (old && YAML.isMap(old)) {
    if (old.commentBefore) node.commentBefore = old.commentBefore;
    for (const pair of old.items) {
      const k = YAML.isScalar(pair.key) ? pair.key.value : pair.key;
      if (k === 'steps') continue;
      const c = pair.value?.comment;
      const target = node.get(k, true);
      if (c && YAML.isNode(target)) target.comment = c;
    }
  }
  if (program.comment !== undefined) {
    const c = String(program.comment || '').trim();
    node.commentBefore = c ? c.split('\n').map((l) => ` ${l.replace(/^#\s?/, '')}`).join('\n') : old?.commentBefore;
  }
  return node;
}

async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) await fsp.copyFile(file, `${file}.bak`);
  const tmp = `${file}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

async function loadForWrite(file) {
  const text = await readText(file);
  if (text === null || !text.trim()) {
    const doc = new YAML.Document({ programs: [] });
    doc.commentBefore = HEADER;
    return doc;
  }
  const doc = parse(text);
  if (!programsNode(doc)) doc.set('programs', doc.createNode([]));
  return doc;
}

const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code, status: 400 });

/**
 * Create or replace one program. `oldName` renames. Refuses a name clash.
 * The program is written even with check errors (the page warns first);
 * the motion server lists such a program with its problem and refuses to run it.
 */
export async function saveProgram(file, rawProgram, oldName = '') {
  const program = normalizeProgram(rawProgram);
  if (rawProgram?.steps) program.steps.forEach((s, i) => (s.note = String(rawProgram.steps[i]?.note || '')));
  if (!NAME_RE.test(program.name)) throw bad('Program name: letters, digits, _ and - (up to 64)');
  if (!program.steps.length) throw bad('A program needs at least one step');
  const text = (await readText(file)) || '';
  const doc = await loadForWrite(file);
  const list = entries(doc);
  const target = list.find((e) => e.name === (oldName || program.name));
  if (list.some((e) => e.name === program.name && e !== target)) throw bad(`A program named "${program.name}" already exists`);
  const coll = programsNode(doc);

  // Splice only this program's text into the file, so everything else keeps
  // its exact formatting. Checked by parsing the result; falls back to
  // re-writing the whole document when that does not give the same program.
  const spliced = YAML.isSeq(coll) && !coll.flow && text ? spliceProgram(text, coll, target, program) : null;
  if (spliced && sameProgram(spliced, program)) {
    await writeAtomic(file, spliced);
    return program.name;
  }
  const node = programNode(doc, program, target?.node);
  if (YAML.isSeq(coll)) {
    if (target) coll.items[target.index] = node;
    else coll.items.push(node);
  } else if (target) {
    target.pair.key = doc.createNode(program.name);
    target.pair.value = node;
  } else coll.set(program.name, node);
  await writeAtomic(file, doc.toString(STRINGIFY));
  return program.name;
}

/** Text of one program as a sequence item at `col` (column of "name:"), without the leading "- ". */
function itemText(program, col, old = null) {
  const tmp = new YAML.Document([]);
  const node = programNode(tmp, { ...program, comment: '' }, old);
  node.commentBefore = undefined;
  tmp.contents.items.push(node);
  const out = tmp.toString(STRINGIFY).replace(/^- /, '');
  const pad = ' '.repeat(Math.max(0, col - 2));
  return out
    .replace(/\n$/, '')
    .split('\n')
    .map((l, i) => (i === 0 || !l ? l : pad + l))
    .join('\n');
}

const lineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;

function spliceProgram(text, coll, target, program) {
  if (target) {
    const [start, , end] = target.node.range || [];
    if (!(start >= 0 && end > start)) return null;
    const col = start - lineStart(text, start);
    let body = itemText(program, col, target.node);
    if (text[end - 1] === '\n') body += '\n';
    return text.slice(0, start) + body + text.slice(end);
  }
  const first = coll.items[0];
  if (!first?.range) return null;
  const col = first.range[0] - lineStart(text, first.range[0]);
  const dash = ' '.repeat(Math.max(0, col - 2));
  const tail = text.endsWith('\n') ? text : `${text}\n`;
  return `${tail}\n${dash}- ${itemText(program, col)}\n`;
}

function sameProgram(text, program) {
  try {
    const found = entries(parse(text)).find((e) => e.name === program.name);
    if (!found) return false;
    const a = programToYaml(toProgram(found));
    const b = programToYaml(program);
    const notes = toProgram(found).steps.map((s) => s.note || '');
    return JSON.stringify(a) === JSON.stringify(b) && notes.join('\u0001') === program.steps.map((s) => String(s.note || '').replace(/\s*\n\s*/g, ' ').trim()).join('\u0001');
  } catch {
    return false;
  }
}

export async function deletePrograms(file, names) {
  const text = (await readText(file)) || '';
  const doc = await loadForWrite(file);
  const coll = programsNode(doc);
  const drop = new Set(names);
  const list = entries(doc);
  const gone = list.filter((e) => drop.has(e.name));
  if (!gone.length) return 0;
  // Cut the items (and the comment block right above each) out of the text.
  if (YAML.isSeq(coll) && !coll.flow && gone.every((e) => e.node?.range)) {
    let out = text;
    for (const e of [...gone].sort((a, b) => b.node.range[0] - a.node.range[0])) {
      let from = lineStart(out, e.node.range[0]);
      for (;;) {
        const prev = lineStart(out, from - 1);
        if (from === 0 || !/^\s*#/.test(out.slice(prev, from))) break;
        from = prev;
      }
      let to = e.node.range[2];
      while (out[to] === '\n' && out[to + 1] === '\n') to += 1;
      out = out.slice(0, from) + out.slice(to);
    }
    try {
      const left = entries(parse(out)).map((e) => e.name);
      const expect = list.filter((e) => !drop.has(e.name)).map((e) => e.name);
      if (JSON.stringify(left) === JSON.stringify(expect)) {
        await writeAtomic(file, out);
        return gone.length;
      }
    } catch {
      /* fall back below */
    }
  }
  coll.items = coll.items.filter((_, i) => !drop.has(list[i]?.name));
  await writeAtomic(file, doc.toString(STRINGIFY));
  return gone.length;
}

/** New order of the programs in the file (names; names not listed keep their place at the end). */
export async function reorderPrograms(file, names) {
  const doc = await loadForWrite(file);
  const coll = programsNode(doc);
  const list = entries(doc);
  const pos = new Map(names.map((n, i) => [n, i]));
  const order = list.map((e) => ({ e, k: pos.has(e.name) ? pos.get(e.name) : names.length + e.index }));
  order.sort((a, b) => a.k - b.k);
  coll.items = order.map(({ e }) => (YAML.isSeq(coll) ? e.node : e.pair));
  await writeAtomic(file, doc.toString(STRINGIFY));
}

/** Replace the whole file with text the user edited (must parse; 'programs' must be a list or map). */
export async function writeRaw(file, text) {
  const doc = parse(String(text ?? ''));
  programsNode(doc);
  await writeAtomic(file, String(text).endsWith('\n') ? String(text) : `${text}\n`);
}

/** Create the file with the starter program (refuses when it exists). */
export async function createFile(file) {
  if (fs.existsSync(file)) throw bad('programs.yaml already exists');
  const text = (await readText(DEFAULT_PROGRAMS_FILE)) ?? `#${HEADER.replace(/\n/g, '\n#')}\nprograms: []\n`;
  await writeAtomic(file, text);
}
