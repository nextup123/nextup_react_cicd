/**
 * Fault database helpers.
 *
 * A fault-log code (0x200B:23) matches the first 4 hex digits of a
 * sub-fault's auxiliaryCode203Fh. The old lookup only searched `faults`,
 * so codes that live in `warnings` showed up as "not in fault DB".
 */

export function flattenDb(db) {
  return [...(db?.faults || []), ...(db?.warnings || [])];
}

export function buildFaultIndex(db) {
  const map = new Map();
  for (const fault of flattenDb(db)) {
    for (const sf of fault.subFaults || []) {
      const key = String(sf.auxiliaryCode203Fh || '').trim().toLowerCase().replace(/^0x/, '').slice(0, 4);
      if (/^[0-9a-f]{4}$/.test(key)) map.set(key, [...(map.get(key) || []), sf]);
    }
  }
  return map;
}

/**
 * A few sub-faults share one code in the manual (E140.0/E140.1,
 * E640.0/E640.1), so the drive's code cannot tell them apart. Show them as
 * one entry naming every candidate instead of silently picking the first.
 */
function mergeCandidates(list) {
  if (list.length === 1) return list[0];
  const seen = new Set();
  return {
    ...list[0],
    subFaultCode: list.map((x) => x.subFaultCode).join(' / '),
    name: list.map((x) => x.name).join(' or '),
    resettable: list.every((x) => x.resettable === 'Yes') ? 'Yes' : 'No',
    candidates: list.map((x) => x.subFaultCode),
    causesAndSolutions: list.flatMap((x) => x.causesAndSolutions || []).filter((c) => !seen.has(c.cause) && seen.add(c.cause)),
  };
}

export function lookupFault(index, code) {
  const n = Number(code);
  if (!index || !Number.isFinite(n) || n === 0) return null;
  const list = index.get(n.toString(16).toLowerCase().padStart(4, '0'));
  return list ? mergeCandidates(list) : null;
}

export function faultCategory(range = '') {
  if (range.includes('Warning')) return 'Warning';
  if (range.includes('Axis')) return 'Axis';
  if (range.includes('Servo drive')) return 'Drive';
  return range && range !== '-' ? range : '—';
}

export const SLOT_REGISTERS = [
  { sub: '0x23', name: 'Fault code', short: 'Code', unit: '' },
  { sub: '0x24', name: 'Time stamp', short: 'Time', unit: 'ms' },
  { sub: '0x26', name: 'Motor speed at fault', short: 'Speed', unit: 'rpm' },
  { sub: '0x29', name: 'Bus voltage', short: 'Bus V', unit: 'V' },
  { sub: '0x2A', name: 'Inputs (DI) state', short: 'In term', unit: '' },
  { sub: '0x2C', name: 'Outputs (DO) state', short: 'Out term', unit: '' },
];

export function formatRegister(reg, value) {
  if (value === null || value === undefined) return '—';
  if (reg.sub === '0x23') return value ? '0x' + Number(value).toString(16).toUpperCase() : '0';
  return `${value}${reg.unit ? ' ' + reg.unit : ''}`;
}

export const codeHex = (n) => '0x' + Number(n).toString(16).toUpperCase();
