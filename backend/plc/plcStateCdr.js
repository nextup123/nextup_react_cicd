// plc/plcStateCdr.js -- reads a raw nextplc/msg/PlcState (CDR bytes) straight into a plain object.
//
// Why: rclnodejs needs ~25 ms of CPU to decode one PlcState (about 300 strings through its native
// structs); at 5 Hz that alone was 12 % of a core. Reading the bytes here takes well under 1 ms.
// The layout follows PlcState.msg field by field (XCDR1, the ROS 2 default). Anything unexpected
// throws, and the caller falls back to the rclnodejs decode.

class Reader {
  constructor(buf) {
    if (buf.length < 4) throw new Error("short message");
    const kind = buf[1]; // 0x00 0x01 = CDR little endian, 0x00 0x00 = big endian
    if (buf[0] !== 0 || (kind !== 0 && kind !== 1)) throw new Error("not plain CDR");
    this.le = kind === 1;
    this.buf = buf;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.base = 4; // alignment is counted from after the encapsulation header
    this.pos = 4;
  }
  align(n) { const off = (this.pos - this.base) % n; if (off) this.pos += n - off; }
  need(n) { if (this.pos + n > this.buf.length) throw new Error("message ends early"); }
  u8() { this.need(1); return this.buf[this.pos++]; }
  u32() { this.align(4); this.need(4); const v = this.dv.getUint32(this.pos, this.le); this.pos += 4; return v; }
  i32() { this.align(4); this.need(4); const v = this.dv.getInt32(this.pos, this.le); this.pos += 4; return v; }
  f32() { this.align(4); this.need(4); const v = this.dv.getFloat32(this.pos, this.le); this.pos += 4; return v; }
  str() {
    const n = this.u32();
    if (n === 0) return "";
    this.need(n);
    const s = this.buf.toString("utf8", this.pos, this.pos + n - 1); // n counts the closing NUL
    this.pos += n;
    return s;
  }
  count() { const n = this.u32(); if (n > 1_000_000) throw new Error("bad sequence length"); return n; }
  strs() { const n = this.count(); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = this.str(); return out; }
  bytes() { const n = this.count(); this.need(n); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = this.buf[this.pos + i]; this.pos += n; return out; }
  bools() { return this.bytes().map(Boolean); }
  i32s() { const n = this.count(); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = this.i32(); return out; }
}

/** Raw PlcState bytes -> the same fields rclnodejs would give (arrays as plain arrays). */
export function decodePlcState(buf) {
  const r = new Reader(buf);
  const header = { stamp: { sec: r.i32(), nanosec: r.u32() }, frame_id: r.str() };
  const m = {
    header,
    program: r.str(),
    program_ok: Boolean(r.u8()),
    safe_state: Boolean(r.u8()),
    scan_count: r.u32(),
    scan_time_ms: r.f32(),
    scan_period_ms: r.f32(),
    forced_count: r.u32(),
    bit_names: r.strs(),
    bit_values: r.bytes(),
    bit_forced: r.bools(),
    logic_q: r.bytes(),
    q_controlled: r.bools(),
    reg_names: r.strs(),
    reg_values: r.i32s(),
    alias_names: r.strs(),
    alias_targets: r.strs(),
    seq_names: r.strs(),
    seq_steps: r.i32s(),
    seq_step_names: r.strs(),
    rung_texts: r.strs(),
    rung_results: r.bools(),
  };
  // sanity: parallel arrays must match, else the layout is not what this file expects
  if (m.bit_values.length !== m.bit_names.length || m.reg_values.length !== m.reg_names.length || m.seq_steps.length !== m.seq_names.length) {
    throw new Error("PlcState layout differs from plcStateCdr.js");
  }
  return m;
}
