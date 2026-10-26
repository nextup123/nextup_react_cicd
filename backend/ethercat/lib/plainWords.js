'use strict';

/**
 * The operator never sees ROS: no node, service, topic or package names and no
 * "ROS 2" wording. The server keeps talking to the hardware through ROS
 * unchanged; this only rewrites text on its way to the browser.
 *
 * Order matters: specific messages first, generic leftovers last.
 */
const RULES = [
  [/SDO transfer aborted: ([^\n]+)/gi, 'Drive refused: $1'],
  [/Failed to (?:download|upload) SDO: Input\/output error/gi, 'No confirmation from the drive (it may be restarting or disconnected)'],
  [/Service '[^']*' not available/gi, 'Drive communication is not running'],
  [/ROS ?2 node not available/gi, 'The drive controller is not connected'],
  [/Service call timed out after (\d+) ?ms/gi, 'The drive did not answer within $1 ms'],
  [/Service returned null response/gi, 'No answer from the drive controller'],
  [/Failed to create message object[^\n]*/gi, 'Internal communication error'],
  [/Node \S+ started[^\n]*/gi, 'Drive communication started'],
  [/Node \S+ is already running/gi, 'Drive communication is already running'],
  [/Node died immediately[^\n]*/gi, 'Drive communication stopped right after starting. Check the drive controller software on this PC.'],
  [/No node running/gi, 'Drive communication is not running'],
  [/Node stopped \(mock\)|Node stop signal sent/gi, 'Drive communication is stopping'],
  [/Node was already gone/gi, 'Drive communication was already stopped'],
  [/Invalid node or package name/gi, 'Invalid request'],
  [/SDO server (started|stopped|failed to start)/gi, 'Drive communication $1'],
  // Leftovers in raw library errors.
  [/\/?ethercat_manager\/\w+/g, 'drive controller'],
  [/\bethercat_(sdo_srv_server|manager|diag_ui_node)\b/g, 'drive controller'],
  [/\brclnodejs\b/gi, 'controller software'],
  [/\bROS ?2\b|\bROS\b/g, 'controller'],
];

// CANopen SDO abort codes the drives send back, in operator words.
const ABORTS = {
  '05040000': 'the drive did not answer in time',
  '06010000': 'this value cannot be accessed',
  '06010001': 'this value can only be written, not read',
  '06010002': 'this value is read-only',
  '06020000': 'this address does not exist on the drive',
  '06040041': 'this value cannot be mapped',
  '06060000': 'hardware error on the drive',
  '06070010': 'wrong data type or length for this value',
  '06070012': 'data too long for this value',
  '06070013': 'data too short for this value',
  '06090011': 'this sub-index does not exist',
  '06090030': 'the value is out of range',
  '06090031': 'the value is too high',
  '06090032': 'the value is too low',
  '08000000': 'general error',
  '08000020': 'the drive cannot accept this value right now',
  '08000021': 'the drive is under local control',
  '08000022': 'the drive is in the wrong state for this change (try with the drive stopped)',
};

function plain(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text.replace(/SDO abort(?: code)?:? ?(?:0x)?([0-9a-f]{8})\b[^\n]*/gi, (m, code) => {
    const why = ABORTS[code.toLowerCase()];
    return why ? `Drive refused: ${why} (code 0x${code.toUpperCase()})` : m;
  });
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

function scrub(value, depth = 0) {
  if (depth > 12) return value;
  if (typeof value === 'string') return plain(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

/** Express middleware: every JSON response from /api goes through scrub(). */
function middleware(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(scrub(body));
  next();
}

module.exports = { plain, scrub, middleware };
