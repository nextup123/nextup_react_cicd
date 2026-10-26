'use strict';

// Small parts of the drive tools: drive activity (software updates wait for it), the drive list.
const test = require('node:test');
const assert = require('node:assert');

test('drive work blocks updates while it lasts', () => {
  const activity = require('../lib/activity');
  activity.reset();
  assert.deepStrictEqual(activity.busy(), { busy: false, what: '' });
  activity.hold('run-1', 'Recipe "Homing" is running');
  assert.strictEqual(activity.busy().what, 'Recipe "Homing" is running');
  activity.release('run-1');
  assert.strictEqual(activity.busy().busy, false);
  // A lease that is not renewed runs out (closed browser).
  activity.hold('run-2', 'Recipe');
  assert.strictEqual(activity.busy(Date.now() + activity.LEASE_MS + 1).busy, false);
  // A write to a drive counts for a while.
  activity.noteWrite('A value was just written to a drive');
  assert.strictEqual(activity.busy().busy, true);
  assert.strictEqual(activity.busy(Date.now() + activity.WRITE_MS + 1).busy, false);
  activity.reset();
});

test('the drive list is read from `ethercat slaves`', () => {
  const { parseEthercatSlaves } = require('../lib/drives');
  const list = parseEthercatSlaves('0  0:0  OP  +  SV660N Servo Drive\n1  0:1  PREOP  +  SV660N Servo Drive');
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list[1], { position: 1, state: 'PREOP', name: 'SV660N Servo Drive' });
});

test('operators never see controller wording', () => {
  const { plain } = require('../lib/plainWords');
  assert.strictEqual(plain("Service '/ethercat_manager/set_sdo' not available"), 'Drive communication is not running');
  assert.match(plain('SDO abort 0x06090030 something'), /out of range/);
});
