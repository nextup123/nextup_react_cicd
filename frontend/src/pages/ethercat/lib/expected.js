/**
 * Validation for GET blocks' "expected value".
 *   "5"        exact (also "0x1F", "-5")
 *   "1-5"      inclusive range (also "1~5", "-10 - -5", "1..5")
 *   "1,2,3"    list
 *   anything else → exact string match
 *
 * The old parser split on every "-", so a negative expected value like
 * "-5" was treated as a malformed range and silently counted as a pass.
 */

const NUM = '(-?(?:0x[0-9a-f]+|\\d+(?:\\.\\d+)?))';
const RANGE_RE = new RegExp(`^${NUM}\\s*(?:~|\\.\\.|\\s-\\s|-)\\s*${NUM}$`, 'i');

export function parseNum(s) {
  const t = String(s ?? '').trim();
  if (/^-?0x[0-9a-f]+$/i.test(t)) return (t.startsWith('-') ? -1 : 1) * parseInt(t.replace(/^-/, ''), 16);
  if (t === '') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function checkExpected(expected, actual) {
  const exp = String(expected ?? '').trim();
  if (!exp) return { pass: true, message: `Read: ${actual}` };
  const a = parseNum(actual);

  const range = exp.match(RANGE_RE);
  if (range) {
    const lo = parseNum(range[1]);
    const hi = parseNum(range[2]);
    const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];
    if (Number.isNaN(a)) return { pass: false, message: `Got non-numeric "${actual}", expected ${min}…${max}` };
    const pass = a >= min && a <= max;
    return { pass, message: `${pass ? 'In' : 'Out of'} range ${min}…${max} (got ${actual})` };
  }

  if (exp.includes(',')) {
    const items = exp.split(',').map((x) => x.trim()).filter(Boolean);
    const nums = items.map(parseNum);
    const pass = nums.every((n) => !Number.isNaN(n)) && !Number.isNaN(a)
      ? nums.includes(a)
      : items.includes(String(actual));
    return { pass, message: `${pass ? 'In' : 'Not in'} [${items.join(', ')}] (got ${actual})` };
  }

  const e = parseNum(exp);
  if (!Number.isNaN(e) && !Number.isNaN(a)) {
    const pass = e === a;
    return { pass, message: `Expected ${exp}, got ${actual}` };
  }
  const pass = String(actual) === exp;
  return { pass, message: `Expected "${exp}", got "${actual}"` };
}
