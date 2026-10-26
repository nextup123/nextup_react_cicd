'use strict';

/**
 * Knows when the drives are being worked on, so an update or restart does not
 * start in the middle of it.
 *
 *   - The screens hold a "lease" while a recipe runs or drive settings are written
 *     (they run step by step from the browser, with pauses between steps). A lease
 *     ends when the screen says so, or 20 s after its last renewal (closed browser).
 *   - Any write to a drive counts as work for 15 s.
 */

const LEASE_MS = 20000;
const WRITE_MS = 15000;

const leases = new Map(); // id -> { what, until }
let lastWrite = null; // { at, what }

function hold(id, what) {
  leases.set(String(id).slice(0, 80), { what: String(what || 'Work on the drives').slice(0, 200), until: Date.now() + LEASE_MS });
}

function release(id) {
  leases.delete(String(id).slice(0, 80));
}

function noteWrite(what) {
  lastWrite = { at: Date.now(), what: String(what || 'A write to a drive').slice(0, 200) };
}

/** { busy: true, what } while something is working on the drives. */
function busy(now = Date.now()) {
  for (const [id, l] of leases) {
    if (l.until > now) return { busy: true, what: l.what };
    leases.delete(id);
  }
  if (lastWrite && now - lastWrite.at < WRITE_MS) return { busy: true, what: lastWrite.what };
  return { busy: false, what: '' };
}

function reset() {
  leases.clear();
  lastWrite = null;
}

module.exports = { hold, release, noteWrite, busy, reset, LEASE_MS, WRITE_MS };
