'use strict';

/**
 * Simulated EtherCAT bus for MOCK=1. Same interface as ros.js.
 * Six Innovance-style drives, an in-memory object dictionary per drive,
 * and a 9-slot fault log on 0x200B that reacts to the 0x22 slot selector.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createLock, delay } = require('./lib/util');

const NUM_SLAVES = Math.max(0, Number.parseInt(process.env.MOCK_DRIVES ?? '6', 10) || 0);
const sdoLock = createLock();
let nodeRunning = false;

const slaves = Array.from({ length: NUM_SLAVES }, (_, i) => ({
  position: i,
  state: i === 4 ? 'PREOP' : 'OP',
  name: 'SV660N Servo Drive',
}));

// Object dictionary: dict[slave]["IIII:SS"] = value
const dict = Array.from({ length: NUM_SLAVES }, () => new Map());
const key = (index, sub) => `${index.toString(16).padStart(4, '0')}:${sub.toString(16).padStart(2, '0')}`;

function seed() {
  let defaults = [];
  try {
    defaults = JSON.parse(fs.readFileSync(path.join(config.DATA_DIR, 'driver_config.json'), 'utf8'));
  } catch { /* fine */ }

  let faultCodes = [];
  try {
    const db = JSON.parse(fs.readFileSync(path.join(config.BUNDLED_DATA_DIR, 'faults.json'), 'utf8'));
    for (const f of [...(db.faults || []), ...(db.warnings || [])]) {
      for (const sf of f.subFaults || []) {
        const hex = String(sf.auxiliaryCode203Fh || '').replace(/^0x/i, '').slice(0, 4);
        if (/^[0-9a-f]{4}$/i.test(hex)) faultCodes.push(parseInt(hex, 16));
      }
    }
  } catch { /* fine */ }
  if (!faultCodes.length) faultCodes = [0x0101, 0x0136, 0x0420];

  for (let s = 0; s < NUM_SLAVES; s++) {
    const d = dict[s];
    for (const r of defaults) {
      d.set(key(parseInt(r.index, 16), parseInt(r.subindex, 16)), r.defaultValue);
    }
    // A few drives drift from the template so the config page has differences to show.
    if (s === 2) d.set(key(0x2005, 0x0a), 5000);
    if (s === 3) d.set(key(0x2003, 0x0b), 12);
    d.set(key(0x1008, 0), 'SV660N');
    d.set(key(0x1018, 1), 0x00100000);
    d.set(key(0x200b, 0x22), 1);
    // Fault history: drive 1 and 3 have faults, the rest are mostly clean.
    d.faultLog = Array.from({ length: 9 }, (_, slot) => {
      const hasFault = (s === 1 && slot < 3) || (s === 3 && slot === 0) || (s === 5 && slot === 6);
      return hasFault
        ? { code: faultCodes[(s * 7 + slot * 3) % faultCodes.length], time: 1200 + slot * 37, speed: 300 - slot * 12, bus: 310 + slot, din: 31, dout: 7 }
        : { code: 0, time: 0, speed: 0, bus: 0, din: 0, dout: 0 };
    });
  }
}
seed();

function readFaultRegister(d, sub) {
  const slot = Math.min(9, Math.max(1, Number(d.get(key(0x200b, 0x22))) || 1));
  const entry = d.faultLog[slot - 1];
  return { 0x23: entry.code, 0x24: entry.time, 0x26: entry.speed, 0x29: entry.bus, 0x2a: entry.din, 0x2c: entry.dout }[sub];
}

function liveValue(index, sub, slave) {
  if (index !== 0x200b) return undefined;
  const t = Date.now() / 1000;
  switch (sub) {
    case 0x01: return Math.round(1500 * Math.sin(t / 3 + slave));
    case 0x1b: return 310 + Math.round(Math.random() * 4);
    case 0x43: return 41 + Math.round(Math.random() * 3);
    case 0x14: return 18234 + slave * 100;
    case 0x40: return 0;
    default: return readFaultRegister(dict[slave], sub);
  }
}

const rebootUntil = {};

// MOCK_FAIL="0:0x200d:0x01,3:0x6060:0" makes those writes fail, to try out error handling.
const FAIL_WRITES = new Set(String(process.env.MOCK_FAIL || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  const [p, i, sub] = x.split(':');
  return `${Number(p)}:${key(parseInt(i, 16), parseInt(sub, 16))}`;
}));

async function handle(type, request) {
  await delay(15 + Math.random() * 30);
  if (!nodeRunning) throw new Error("Service '/ethercat_manager/set_sdo' not available");
  const pos = request.slave_position;
  if (pos < 0 || pos >= NUM_SLAVES) {
    return { success: false, sdo_return_message: `No slave at position ${pos}`, sdo_return_value: 0, sdo_return_value_string: '' };
  }
  const d = dict[pos];
  const k = key(request.sdo_index, request.sdo_subindex);

  // A drive that is rebooting (software reset) does not answer for a few seconds.
  if (rebootUntil[pos] > Date.now()) {
    await delay(300);
    return { success: false, sdo_return_message: `Failed to ${type.endsWith('SetSdo') ? 'download' : 'upload'} SDO: Input/output error`, sdo_return_value: 0, sdo_return_value_string: '' };
  }

  if (type.endsWith('SetSdo')) {
    if (FAIL_WRITES.has(`${pos}:${k}`)) {
      return { success: false, sdo_return_message: 'SDO abort 0x08000022: data cannot be transferred in the present device state (mock)' };
    }
    const v = request.sdo_data_type === 'string' ? request.sdo_value : Number(request.sdo_value);
    if (request.sdo_data_type !== 'string' && Number.isNaN(v)) {
      return { success: false, sdo_return_message: `Invalid value "${request.sdo_value}"` };
    }
    if (request.sdo_index === 0x200d && request.sdo_subindex === 0x01 && v === 1) {
      // Like the real SV660N: the drive reboots mid-transfer, so the write
      // takes effect but is never confirmed.
      rebootUntil[pos] = Date.now() + 4000;
      await delay(300);
      return { success: false, sdo_return_message: 'Failed to download SDO: Input/output error' };
    }
    d.set(k, v);
    if (request.sdo_index === 0x6040 && v === 128) {
      // Fault reset clears the most recent fault slot.
      d.faultLog[0] = { code: 0, time: 0, speed: 0, bus: 0, din: 0, dout: 0 };
    }
    return { success: true, sdo_return_message: 'SDO write OK (mock)' };
  }

  let value = liveValue(request.sdo_index, request.sdo_subindex, pos);
  if (value === undefined) value = d.has(k) ? d.get(k) : 0;
  return {
    success: true,
    sdo_return_value: typeof value === 'number' ? value : 0,
    sdo_return_value_string: String(value),
    sdo_return_message: 'SDO read OK (mock)',
  };
}

module.exports = {
  mock: true,
  init: async () => { console.log('[MOCK] Simulated EtherCAT bus with', NUM_SLAVES, 'drives'); },
  callService: (type, _name, request) => sdoLock(() => handle(type, request)),
  exclusive: (fn) => sdoLock(() => fn((type, _name, request) => handle(type, request))),
  destroyAllClients: () => {},
  shutdown: async () => {},
  isReady: () => true,
  initError: () => null,
  clientCount: () => 0,
  slaves: () => slaves.map((s) => ({ ...s })),
  setNodeRunning: (v) => { nodeRunning = v; },
};
