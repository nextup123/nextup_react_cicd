// Expands a robot description (.urdf.xacro / .xacro / .urdf) into plain URDF.
//
// The ROS `xacro` tool is used when it is on the PATH (the backend runs with
// the ROS workspaces sourced on the robot). Without it (a dev machine, or a
// package the tool cannot find) a built-in expander handles the common
// subset: properties, args, ${expressions}, $(find pkg) / $(arg) / $(env),
// include, if / unless and macros with plain and block parameters.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { DOMParser, XMLSerializer } from 'xmldom';

const TOOL_TIMEOUT_MS = 15000;
let toolMissing = false;

function runTool(file) {
  return new Promise((resolve, reject) => {
    execFile('xacro', [file], { timeout: TOOL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') toolMissing = true;
        reject(new Error((stderr || err.message || '').trim().split('\n').slice(-2).join(' ')));
      } else resolve(stdout);
    });
  });
}

/** Returns { xml, tool: 'xacro' | 'builtin' | 'none', toolError? }. */
export async function expandXacro(file, { findPackage }) {
  const isXacro = /\.xacro$/i.test(file);
  if (!isXacro) return { xml: fs.readFileSync(file, 'utf8'), tool: 'none' };
  let toolError;
  if (!toolMissing && process.env.NEXTUP_BUILTIN_XACRO !== '1') {
    try {
      return { xml: await runTool(file), tool: 'xacro' };
    } catch (err) {
      toolError = toolMissing ? undefined : err.message;
    }
  }
  return { xml: builtinXacro(file, { findPackage }), tool: 'builtin', toolError };
}

// ───────────────────────── built-in expander ─────────────────────────

const isXacroEl = (n) => n.nodeType === 1 && (n.prefix === 'xacro' || n.nodeName.startsWith('xacro:'));
const xacroName = (n) => n.nodeName.replace(/^xacro:/, '');
const MATH = { pi: Math.PI, e: Math.E, True: true, False: false, true: true, false: false, None: null };
const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'floor', 'ceil', 'pow', 'exp', 'log', 'min', 'max', 'radians', 'degrees', 'float', 'int', 'str', 'round']);
const FUNC_IMPL = {
  ...Object.fromEntries(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'floor', 'ceil', 'pow', 'exp', 'log', 'min', 'max', 'round'].map((f) => [f, Math[f]])),
  radians: (d) => (d * Math.PI) / 180,
  degrees: (r) => (r * 180) / Math.PI,
  float: Number,
  int: (v) => Math.trunc(Number(v)),
  str: String,
};

function parseXml(text, file) {
  const errors = [];
  const doc = new DOMParser({ errorHandler: { error: (m) => errors.push(m), fatalError: (m) => errors.push(m), warning: () => {} } }).parseFromString(text, 'text/xml');
  if (!doc?.documentElement || errors.length) throw new Error(`${path.basename(file)}: ${errors[0] || 'not valid XML'}`);
  return doc;
}

function toValue(s) {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return s;
}

/** Evaluates one ${...} expression. Only names, numbers, strings and a few maths functions are allowed. */
function evalExpr(expr, scope) {
  const out = [];
  const re = /\s+|'[^']*'|"[^"]*"|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_][\w.]*|==|!=|<=|>=|\*\*|[-+*/%<>(),]/y;
  let m;
  let i = 0;
  while (i < expr.length) {
    re.lastIndex = i;
    m = re.exec(expr);
    if (!m) throw new Error(`cannot evaluate \${${expr}}`);
    i = re.lastIndex;
    const tok = m[0];
    if (/^\s+$/.test(tok)) out.push(' ');
    else if (/^[A-Za-z_]/.test(tok)) {
      if (tok === 'and') out.push('&&');
      else if (tok === 'or') out.push('||');
      else if (tok === 'not') out.push('!');
      else if (FUNCS.has(tok)) out.push(`F.${tok}`);
      else if (tok.startsWith('math.') && FUNCS.has(tok.slice(5))) out.push(`F.${tok.slice(5)}`);
      else if (tok.startsWith('math.') && tok.slice(5) in MATH) out.push(JSON.stringify(MATH[tok.slice(5)]));
      else if (tok in scope.props) out.push(JSON.stringify(toValue(scope.props[tok])));
      else if (tok in MATH) out.push(JSON.stringify(MATH[tok]));
      else throw new Error(`unknown name '${tok}' in \${${expr}}`);
    } else if (tok[0] === "'" || tok[0] === '"') out.push(JSON.stringify(tok.slice(1, -1)));
    else out.push(tok);
  }
  // eslint-disable-next-line no-new-func
  return new Function('F', `return (${out.join('')});`)(FUNC_IMPL);
}

function substitute(text, scope) {
  if (!text || !text.includes('$')) return text;
  let s = text.replace(/\$\((\w+)\s*([^)]*)\)/g, (all, cmd, rest) => {
    const args = rest.trim().split(/\s+/);
    if (cmd === 'find') {
      const p = scope.findPackage(args[0]);
      if (!p) throw new Error(`package '${args[0]}' not found`);
      return p;
    }
    if (cmd === 'arg') return String(scope.args[args[0]] ?? '');
    if (cmd === 'env') return process.env[args[0]] ?? '';
    if (cmd === 'optenv') return process.env[args[0]] ?? args.slice(1).join(' ');
    if (cmd === 'dirname') return scope.dir;
    return all;
  });
  // A whole-value expression keeps its type (numbers, booleans for if/unless).
  const whole = /^\$\{([^{}]*)\}$/.exec(s.trim());
  if (whole) return evalExpr(whole[1], scope);
  s = s.replace(/\$\{([^{}]*)\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return typeof v === 'number' ? String(Number(v.toPrecision(15))) : String(v);
  });
  return s;
}

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'True' || (typeof v === 'number' && v !== 0);

function processChildren(parent, scope) {
  for (const child of Array.from(parent.childNodes)) processNode(child, scope);
}

function replaceWith(node, nodes) {
  const parent = node.parentNode;
  for (const n of nodes) parent.insertBefore(n, node);
  parent.removeChild(node);
}

function processNode(node, scope) {
  if (node.nodeType === 3) {
    if (node.data.includes('$')) node.data = String(substitute(node.data, scope));
    return;
  }
  if (node.nodeType !== 1) return;
  if (!isXacroEl(node)) {
    for (const a of Array.from(node.attributes || [])) {
      if (a.name.startsWith('xmlns')) continue;
      if (a.value.includes('$')) node.setAttribute(a.name, String(substitute(a.value, scope)));
    }
    processChildren(node, scope);
    return;
  }
  const kind = xacroName(node);
  const attr = (n) => (node.hasAttribute(n) ? substitute(node.getAttribute(n), scope) : undefined);
  switch (kind) {
    case 'property': {
      const name = node.getAttribute('name');
      if (node.hasAttribute('value')) scope.props[name] = toValue(attr('value'));
      else if (node.hasAttribute('default')) {
        if (!(name in scope.props)) scope.props[name] = toValue(attr('default'));
      } else scope.blocks[name] = node;
      node.parentNode.removeChild(node);
      return;
    }
    case 'arg': {
      const name = node.getAttribute('name');
      if (!(name in scope.args)) scope.args[name] = node.hasAttribute('default') ? attr('default') : '';
      node.parentNode.removeChild(node);
      return;
    }
    case 'if':
    case 'unless': {
      const v = truthy(attr('value'));
      if (v === (kind === 'if')) {
        processChildren(node, scope);
        replaceWith(node, Array.from(node.childNodes));
      } else node.parentNode.removeChild(node);
      return;
    }
    case 'include': {
      let file = String(attr('filename'));
      if (!path.isAbsolute(file)) file = path.resolve(scope.dir, file);
      const doc = parseXml(fs.readFileSync(file, 'utf8'), file);
      const sub = { ...scope, dir: path.dirname(file) };
      const root = doc.documentElement;
      processChildren(root, sub);
      Object.assign(scope.props, sub.props);
      Object.assign(scope.macros, sub.macros);
      const owner = node.ownerDocument;
      replaceWith(node, Array.from(root.childNodes).map((n) => owner.importNode(n, true)));
      return;
    }
    case 'macro': {
      const params = (node.getAttribute('params') || '').trim().split(/\s+/).filter(Boolean).map((p) => {
        const block = p.startsWith('**') ? 2 : p.startsWith('*') ? 1 : 0;
        const [name, def] = p.replace(/^\*+/, '').split(/:=|=/);
        return { name, block, def: def?.replace(/^\^\|?/, '') };
      });
      scope.macros[node.getAttribute('name')] = { params, node };
      node.parentNode.removeChild(node);
      return;
    }
    case 'insert_block': {
      const block = scope.blocks[node.getAttribute('name')];
      if (!block) {
        node.parentNode.removeChild(node);
        return;
      }
      const owner = node.ownerDocument;
      const nodes = block.isMacroArg ? [owner.importNode(block.el, true)] : Array.from(block.childNodes).map((n) => owner.importNode(n, true));
      nodes.forEach((n) => node.parentNode.insertBefore(n, node));
      node.parentNode.removeChild(node);
      nodes.forEach((n) => processNode(n, scope));
      return;
    }
    default: {
      const macro = scope.macros[kind];
      if (!macro) {
        node.parentNode.removeChild(node);
        return;
      }
      const sub = { ...scope, props: { ...scope.props }, blocks: { ...scope.blocks } };
      const elems = Array.from(node.childNodes).filter((n) => n.nodeType === 1);
      let bi = 0;
      for (const p of macro.params) {
        if (p.block === 1) sub.blocks[p.name] = { isMacroArg: true, el: elems[bi++] };
        else if (p.block === 2) {
          const el = elems[bi++];
          sub.blocks[p.name] = el;
        } else if (node.hasAttribute(p.name)) sub.props[p.name] = toValue(substitute(node.getAttribute(p.name), scope));
        else if (p.def !== undefined) sub.props[p.name] = toValue(substitute(p.def, scope));
      }
      const owner = node.ownerDocument;
      const body = Array.from(macro.node.childNodes).map((n) => owner.importNode(n, true));
      body.forEach((n) => node.parentNode.insertBefore(n, node));
      node.parentNode.removeChild(node);
      body.forEach((n) => processNode(n, sub));
      Object.assign(scope.macros, sub.macros);
    }
  }
}

export function builtinXacro(file, { findPackage, args = {} }) {
  const doc = parseXml(fs.readFileSync(file, 'utf8'), file);
  const scope = { props: {}, args: { ...args }, macros: {}, blocks: {}, dir: path.dirname(file), findPackage };
  processChildren(doc.documentElement, scope);
  return new XMLSerializer().serializeToString(doc);
}
