# nextplc – how to write the logic

`nextplc` is a soft PLC for the Nextup robot. It runs as one ROS 2 node next to the controllers
(the controllers are not changed). You write the logic in one YAML file. This document explains
every line of that file, the way a PLC teacher would: *if this DI is 1, then this DO becomes 1*.

Raw addresses are used everywhere. Names (aliases) are optional, see section 12.

---

## 0. The picture in your head

The PLC has a table in memory. Every **10 ms** (one *scan*) it does three things:

1. **Read** – the latest values from the controller topics are copied into the table
   (`joint1.di1 … joint6.di8`, `gpio1.di1 … gpio1.di8`, and the supervisor state into `S.*`).
2. **Scan** – your rungs run from the top of the file to the bottom, one by one. Each rung looks
   at some bits and writes one bit (or one register). Then the sequences run.
3. **Write** – every physical output (`Q`) that changed in this scan is sent to the existing DO
   controller topic. Unchanged outputs are not sent again.

Then it waits for the next 10 ms and does it again. Forever. That is the whole engine.

The table has five areas:

| Area | Addresses | Who writes it |
|---|---|---|
| `I` physical inputs | `joint1..joint6 . di1..di8` (di6..di8 = STO1, STO2, EDM), `gpio1 . di1..di8` | nobody – read only |
| `Q` physical outputs | `joint1..joint6 . do1, do2, do3, pi_p`, `gpio1 . do1..do8` | **only rungs and sequences** – and only the outputs that appear in the program are touched at all (section 13) |
| `M` virtual bits | `M0 … M127` | rungs, sequences, BT, web |
| `R` registers (int32) | `R0 … R31` | rungs, BT, web |
| `S` system bits | `S.AUTO S.SAFEAUTO S.JOG S.ARMED S.EMERGENCY S.ESTOP S.STANDSTILL S.ANY_FAULT S.IO_FAULT S.DI_OK S.SUPERVISOR_OK S.FIRST_SCAN S.BLINK_1HZ S.BLINK_2HZ S.PROGRAM_OK S.SAFE_STATE` | the engine – read only |

Addresses are not case sensitive (`M10` = `m10`, `S.AUTO` = `s.auto`).

---

## 1. Coil – the basic rung

```yaml
rungs:
  - {out: gpio1.do1, when: "gpio1.di1"}
```

Every scan: look at `gpio1.di1`. If it is 1, write 1 to `gpio1.do1`. If it is 0, write 0.
The output follows the input, always. This is a relay contact and a coil.

```yaml
  - {out: joint6.do2, when: "gpio1.di1 AND M10"}
```
`joint6.do2` is 1 only when **both** `gpio1.di1` is 1 **and** `M10` is 1. Contacts in series.

```yaml
  - {out: joint6.do2, when: "gpio1.di1 OR M10"}
```
`joint6.do2` is 1 when `gpio1.di1` is 1, or `M10` is 1, or both. Contacts in parallel.

```yaml
  - {out: joint6.do2, when: "gpio1.di1 AND NOT gpio1.di2"}
```
1 when `gpio1.di1` is 1 **and** `gpio1.di2` is 0. `NOT` is a normally-closed contact.

```yaml
  - {out: M20, when: "(gpio1.di1 OR gpio1.di2) AND S.AUTO"}
```
Brackets work like in maths. Here the output is a virtual bit: other rungs, the BT and the web
can read `M20`.

**Rule:** a coil writes its bit **every scan**, both 1 and 0. The moment the condition is false,
the output is 0. A coil remembers nothing.

**Rule:** every `Q` or `M` bit has **one** `out:` rung. A second `out:` for the same bit is a
load error (the file is refused with the line number). So there is never a hidden "last rung
wins" for coils.

---

## 2. Set / Reset – when the bit must remember

```yaml
  - {set:   M21, when: "gpio1.di3"}
  - {reset: M21, when: "gpio1.di4"}
```

Line 1: while `gpio1.di3` is 1, `M21` becomes 1. When `gpio1.di3` goes back to 0, `M21` **stays**
1. Nothing clears it.
Line 2: while `gpio1.di4` is 1, `M21` becomes 0. It stays 0 until line 1 sets it again.

If `gpio1.di3` and `gpio1.di4` are both 1 in the same scan, the rung **lower in the file wins**
(here: reset). Put the one that must win last.

A bit may have many `set:` and `reset:` rungs, but then it may not have an `out:` rung.

Use this for a latched alarm, a "machine started" flag, a "part is inside" memory.

---

## 3. Edges – react only at the moment of change

```yaml
  - {out: M22, when: "RISE(gpio1.di5)"}
```

`RISE(x)` is 1 for **exactly one scan** (10 ms), at the moment `x` goes from 0 to 1. Then it is
0 again, even if `x` stays 1. So `M22` gives one 10 ms pulse each time `gpio1.di5` is pressed.
Pressing and holding gives one pulse. `FALL(x)` is the same for 1 → 0.

**Rule:** an edge needs to see the "0" first. If `gpio1.di5` is already 1 when the program is
loaded (or when a sequence step is entered), that is **not** an edge. The next 0 → 1 is.

Use edges for counting, push buttons, "start once".

---

## 4. Timers

**On delay – `ton`**
```yaml
  - {out: gpio1.do2, when: "gpio1.di1", ton: 500ms}
```
`gpio1.di1` goes 1 → the engine starts counting. After `gpio1.di1` has been 1 for 500 ms
**without a break**, `gpio1.do2` becomes 1. If `gpio1.di1` goes 0 before 500 ms, the count
restarts from zero and `gpio1.do2` stays 0. When `gpio1.di1` goes 0, `gpio1.do2` goes 0 at once.
Use: sensor debounce, "wait a little after the part arrives".

**Off delay – `tof`**
```yaml
  - {out: gpio1.do3, when: "M10", tof: 2s}
```
`M10` goes 1 → `gpio1.do3` is 1 at once. `M10` goes 0 → `gpio1.do3` **stays** 1 for 2 s, then 0.
If `M10` comes back within the 2 s, the output never went off and the 2 s start again next time.
Use: keep a lamp or a blower on a little longer.

**Pulse – `tp`**
```yaml
  - {out: gpio1.do4, when: "RISE(M11)", tp: 300ms}
```
The moment the condition becomes 1, `gpio1.do4` is 1 for exactly 300 ms, then 0. What the
condition does during those 300 ms does not matter. A new trigger during the pulse is ignored.
Use: a short "ready" signal to a machine, a horn beep, a reset pulse.

**"Has been 1 for …" – `ON_FOR` / `OFF_FOR`** (inside the condition)
```yaml
  - {set: M23, when: "ON_FOR(gpio1.do1 AND NOT gpio1.di1, 2s)"}
```
Reads: "`gpio1.do1` is 1 and `gpio1.di1` is 0, and this has been true for 2 s continuously" →
set `M23`. Typical fault check: output commanded, feedback sensor not coming.
`OFF_FOR(x, 2s)` is the opposite: x has been 0 for 2 s.

Times are written with a unit: `300ms`, `2s`, `1.5s`, `1min`. Only `out:` rungs take
`ton:`/`tof:`/`tp:`, and only one of them.

**Time from a register (changeable while running)**
```yaml
  - {move: R10, value: 500, when: "S.FIRST_SCAN AND R10 == 0"}   # default 500 ms
  - {out: gpio1.do2, when: "gpio1.di1", ton: R10}                # on delay = R10 milliseconds
  - {out: gpio1.do3, when: "ON_FOR(gpio1.di1, R10)"}             # the same inside a condition
```
`R10` holds milliseconds and is read every scan: `set_bits R10 1500` from the web or the BT changes
the delay to 1.5 s. Put `R10` in `retain:` and it survives a restart.

---

## 5. Counter

```yaml
  - {count: R0, up: "RISE(gpio1.di6)", reset: "RISE(gpio1.di7)", preset: 10, done: M24}
```

Every rising edge of `gpio1.di6`: `R0` + 1. Rising edge of `gpio1.di7`: `R0` = 0.
While `R0 >= 10`, `M24` is 1; otherwise 0.

- `up:` and `down:` count edges themselves, so `up: "gpio1.di6"` works too (one count per 0 → 1).
- `down:` counts −1.
- `reset:` is a level: while it is 1 the count stays 0.
- `preset:` may be a number or a register: `preset: R2`.
- `done:` is optional and belongs to this rung (one owner).
- The register **is** the counter. The BT or the web may write it (for example back to 0); the
  rung continues from the new value. `move:`/`calc:` rungs may **not** write a counter register.

---

## 6. Numbers – move, calc, compare

```yaml
  - {move: R1, value: 3, when: "RISE(gpio1.di8)"}
```
While the condition is 1, `R1` = 3. With `RISE(...)` that is only the one scan of the edge; after
that `R1` keeps 3 until something else writes it. Without `when:` the move runs every scan.

```yaml
  - {calc: "R2 = R0 * 2 + R1"}
```
Every scan: `R2` is recomputed. `+ - * / %` are allowed, brackets too. Division by zero gives 0
(never a crash). Numbers are whole numbers (int32).

```yaml
  - {out: M25, when: "R0 >= R2 AND S.AUTO"}
```
Comparisons: `== != < <= > >=` (`=` also works for `==`). A bit in arithmetic counts as 0 / 1.

---

## 7. Toggle

```yaml
  - {toggle: gpio1.do5, when: "gpio1.di1"}
```
Each 0 → 1 of the condition flips `gpio1.do5`: 0 → 1, next time 1 → 0. Holding the button does
not flip again. A toggled bit has one owner, like a coil.

---

## 8. System bits in rungs

```yaml
  - {out: gpio1.do6, when: "S.AUTO AND NOT S.EMERGENCY"}
  - {out: gpio1.do7, when: "S.EMERGENCY AND S.BLINK_1HZ"}
  - {move: R5, value: 1, when: "S.FIRST_SCAN"}
```

| Bit | 1 when |
|---|---|
| `S.AUTO` `S.SAFEAUTO` `S.JOG` | the supervisor profile is AUTO / SAFEAUTO / JOG |
| `S.ARMED` | the supervisor passes motion commands to the drives |
| `S.EMERGENCY` | an emergency is latched (also when the supervisor status is missing) |
| `S.ESTOP` | the hardware e-stop input is pressed |
| `S.STANDSTILL` | all joints stand still |
| `S.ANY_FAULT` | a drive reports a fault |
| `S.IO_FAULT` | an output was not applied by its controller, or the inputs are stale |
| `S.DI_OK` `S.SUPERVISOR_OK` | the input topics / the supervisor status are fresh |
| `S.FIRST_SCAN` | only in the first scan after a program load (initial values) |
| `S.BLINK_1HZ` `S.BLINK_2HZ` | toggles every 500 ms / 250 ms (lamps) |
| `S.PROGRAM_OK` `S.SAFE_STATE` | a program runs / the outputs are held in the safe state |
| `S.PLC_EMERGENCY` | an `emergency:` rung fired and the supervisor has not confirmed yet (section 8a) |

---

## 8a. Emergency – stop the robot from the program

```yaml
  - {emergency: "NOT gpio1.di5 AND S.AUTO AND S.ARMED", text: "Door opened while running"}
```
Reads: "the moment `gpio1.di5` becomes 0 while the robot runs in AUTO → **emergency stop of the
robot**". The rung fires on the **rising edge** of its condition (once, not every scan):

1. same scan: `S.PLC_EMERGENCY` = 1, every controlled output goes to its `safe_state` value
   (exempt ones keep following the rungs), every sequence goes idle, the rungs keep running;
2. the node calls `/nextup_motion_supervisor/trigger_emergency` (`std_srvs/Trigger`, parameter
   `emergency_service`) – the same service the e-stop handling and the web UI use; log line
   `EMERGENCY from the program: …`, an alarm `S.PLC_EMERGENCY` on `/nextplc/alarms`, a toast;
3. no service / failure → the call is repeated every second (`emergency_retry_ms`), outputs stay safe;
4. the supervisor reports `emergency_latched` → `S.EMERGENCY` = 1 and the PLC latch is handed over
   (`S.PLC_EMERGENCY` back to 0). The operator resets with the supervisor's `reset_fault`; a
   program reload also clears the PLC latch.

`text:` is optional. This is a functional stop through software; the hardware e-stop / STO chain
stays the safety chain.

---

## 9. The behaviour tree and the PLC – the handshake

The BT only writes `M` bits and `R` registers. It never writes a `Q`. Every `Q` passes through a
rung, so every interlock is always in force even if the BT is wrong.

Rungs:
```yaml
  - {out: gpio1.do1, when: "M10 AND gpio1.di1"}         # line A
  - {out: M11,       when: "gpio1.do1 AND gpio1.di2"}   # line B
  - {out: M12,       when: "NOT gpio1.di2"}             # line C
```

Behaviour tree (nodes of `control_logic_bt`, folder `nextplc`):
```xml
<Sequence>
  <MoveTo pose="P1"/>
  <SetBit  address="M10" value="1"/>
  <WaitBit address="M11" value="1" timeout_ms="5000"/>
  <MoveTo pose="P2"/>
  <SetBit  address="M10" value="0"/>
  <WaitBit address="M12" value="1" timeout_ms="5000"/>
</Sequence>
```

In time order:

1. Robot at P1. `SetBit` publishes `/nextplc/set_bits {name: [M10], value: [1]}`. Within one
   scan `M10` = 1.
2. Line A: `M10` is 1. If the sensor `gpio1.di1` is 1 too (a part is there), `gpio1.do1` becomes 1
   and the engine sends it to `/nextup_gpio_command_controller/commands`. The real output switches
   about 15–25 ms after the BT set the bit. If `gpio1.di1` is 0 nothing happens: the interlock is in
   the PLC, the BT cannot force it.
3. Line B: `gpio1.do1` is 1 and the feedback sensor `gpio1.di2` comes 1 → `M11` = 1.
4. `WaitBit M11` sees 1, the tree continues. If `gpio1.di2` never comes, `WaitBit` fails after 5 s
   and the tree takes its error branch.
5. `SetBit M10 = 0`. Line A: `gpio1.do1` = 0. Line B: `M11` = 0.
6. Line C: when `gpio1.di2` drops, `M12` = 1 and the tree continues.

BT nodes: `SetBit(address, value)`, `PulseBit(address, ms)`, `WaitBit(address, value, timeout_ms)`,
`CheckBit(address, value)`, `SetRegister(address, value)`, `GetRegister(address) → value`.
`address` is a raw address or an alias (the port is not called `name` because BehaviorTree.CPP
reserves that word).
A bit the PLC drives with `out:` cannot be set by the BT (refused with the rung number).

---

## 10. Sequences – step logic

For an ordered process, instead of many set/reset rungs you write steps (SFC / GRAFCET style):

```yaml
sequences:
  - name: seq1
    start: "S.AUTO AND RISE(gpio1.di7)"
    abort: "S.EMERGENCY OR NOT S.AUTO"
    steps:
      - {name: s1, do: [],                 next: "gpio1.di1"}
      - {name: s2, do: [gpio1.do1],        next: "gpio1.di2", timeout: 2s, on_timeout: M30}
      - {name: s3, do: [gpio1.do1, M11],   next: "M13"}
      - {name: s4, do: [],                 next: "NOT gpio1.di2", timeout: 2s, on_timeout: M30}
      - {name: s5, do: [M14],              next: "TRUE"}
```

How it runs:

- Idle (step 0) until `start` is 1: AUTO and a rising edge on `gpio1.di7`. Then step **s1**.
- **s1**: `do` is empty → all bits the sequence owns (`gpio1.do1`, `M11`, `M14`) are 0. Waits
  until `gpio1.di1` is 1, then **s2**.
- **s2**: `gpio1.do1` = 1. Waits for `gpio1.di2`. If that takes longer than 2 s, `M30` is set to 1
  (it stays 1 – reset it with a rung) and the sequence goes to idle, outputs 0.
- **s3**: `gpio1.do1` stays 1, `M11` = 1 (the BT waits on `M11` and does its motion). Waits until
  the BT sets `M13`.
- **s4**: `gpio1.do1` = 0 (not in `do` any more), `M11` = 0. Waits until `gpio1.di2` is 0.
- **s5**: `M14` = 1 for one scan; `next: TRUE` → idle in the next scan. If `M14` must stay on, give
  it set/reset rungs instead.
- At any time, if `abort` is 1 (emergency, left AUTO) → idle, all its outputs 0.

Timing rules:
- A step is entered in one scan and its outputs are written at once. Its `next` is checked from
  the **next** scan on. Edge/timer memory inside `next` is reset on entry (no old edge).
- Rungs run **before** the sequences. A rung that reads `seq.seq1.s2` sees the step of the previous
  scan (10 ms late). A sequence that reads an `M` bit written by a rung sees it in the same scan.
- Every scan `start` and `abort` are evaluated (so their `RISE` memory stays current), but `start`
  acts only when idle and `abort` only when running.
- An emergency (`S.EMERGENCY`) puts every sequence to idle, even without `abort:`.

Other rungs can read: `seq.seq1.step` (0 = idle, 1..n), `seq.seq1.active`, `seq.seq1.s2`
(1 while s2 runs): `- {out: gpio1.do8, when: "seq.seq1.s2 OR seq.seq1.s3"}`.

Ownership: a bit in a `do:` belongs to the sequence; it cannot also have an `out:`, `toggle:`,
`set:` or `reset:` rung. `on_timeout` bits are "set" type: they may share with set/reset rungs.

---

## 11. Alarms

```yaml
alarms:
  - {bit: M30, text: "gpio1.di2 did not come within 2 s", level: error, toast: true}
```
When `M30` goes 0 → 1 the text is published on `/nextplc/alarms` and, with `toast: true`, shown
in the web UI (`/bt_toast_popup`, `error`/`warning` = failure, `info` = success). The 1 → 0 edge
is published too (`active: false`). `M30` itself is reset by a normal rung.

---

## 12. Names (aliases) – optional

```yaml
io:
  I: {part_present: gpio1.di4}
  Q: {clamp: gpio1.do3}
  M: {at_p1: M10}
  R: {part_count: R0}
names: {start_button: gpio1.di7}     # flat form: the area comes from the address
rungs:
  - {out: clamp, when: "part_present AND at_p1"}
```
A name is just another way to write the address. Names: letters, digits, `_`; not a raw address,
not a keyword, unique. The web UI and the BT may use the name or the address. `/nextplc/state`
publishes the alias table so the monitor can show both.

---

## 13. Which outputs belong to the PLC

Only the physical outputs that are **written somewhere in the program** (`out:`, `set:`, `reset:`,
`toggle:`, `done:`, a sequence `do:`) are controlled by the PLC. Every other DO is never sent by the
PLC: the BT `DoControl` / `GpioDoControl` nodes, the web UI and `ros2 topic pub` can use it as before.

```yaml
rungs:
  - {out: joint1.do3, when: "joint1.di1 OR joint1.di3"}
  - {set: joint3.do1, when: "joint2.di2"}
  - {reset: joint3.do1, when: "joint1.di1"}
```
Here the PLC controls `joint1.do3` and `joint3.do1` (the log says `controls 2 of 32 outputs, the
others stay free`). `joint2.do1`, `gpio1.do1 … do8` and all the rest are free. `/nextplc/state`
shows this per output in `q_controlled`.

Rules for a controlled output: it is written once at program load, sent again when it changes,
re-sent when something else switches it (the program wins), and put to its safe value in the safe
state. A free output: nothing of that. If a reload removes an output from the program, the PLC
writes it 0 one last time and then leaves it alone.

Node parameter `control_unused_outputs: true` (config/nextplc.yaml) switches to "the PLC owns
all 32 outputs": then every DO not in the program is held at its safe value (0) and nobody else can
switch it. Default is `false`.

## 14. Safe state

```yaml
safe_state:
  default: 0
  gpio1.do1: 1
  exempt: [gpio1.do7]
```
The controlled outputs go to their safe value (default 0, `gpio1.do1` → 1) when:
- an emergency is latched (`S.EMERGENCY`), also while the supervisor status is missing;
- no program is loaded (load error at start) – then everything is 0;
- the digital input topics are stale (parameter `hold_on_stale_inputs`);
- the node stops.

Rungs and sequences keep running during an emergency (M and R keep working, lamps can blink),
but what they write to a non-exempt `Q` is not sent to the hardware. `exempt:` outputs follow the
rungs even in the safe state (lamps, horn). When the emergency is reset, the outputs follow the
rungs again at once. Sequences are put to idle by an emergency.

In an expression, `gpio1.do1` is the value the **logic** wants; the physical value can differ
during the safe state (`/nextplc/state` shows both).

---

## 15. Retained registers

```yaml
retain: [R0, R2]
```
These registers are written to `retain.yaml` when they change and restored at the next start.
Everything else starts at 0.

---

## 16. The file, the services, the rules

**File** – `/home/nextup/user_config_files/plc/program.yaml` (parameter `program_file`).
Sections: `program`, `scan_ms`, `io`, `names`, `retain`, `safe_state`, `rungs`, `sequences`,
`alarms`. Unknown sections or keys are errors (typo protection).

**Library blocks** – `blocks: - {use: cylinder, as: clamp, with: {request: M10, extend_cmd: gpio1.do1, …}}`
puts a tested block (cylinder, motor starter, two-hand start, lamp tower …) into the program with your
addresses on its ports; `clamp.busy` etc. are readable. **Simulator** – `nextplc_sim program.yaml
scenario.sim` runs the program against scripted inputs and sensor models without the robot. See
[BLOCKS.md](BLOCKS.md) and [SIMULATOR.md](SIMULATOR.md).

**Check without the robot** – `ros2 run nextplc nextplc_check program.yaml`

**Reload while running** – `ros2 service call /nextplc/load_program nextplc/srv/LoadProgram "{path: ''}"`
A file with any error is refused as a whole, with `line N: …`; the old program keeps running.
On a successful reload M and R keep their values, timers, edges and sequences start fresh, and
every output is sent once so the hardware matches the image.

**Write from outside** – topic or service `/nextplc/set_bits` `{name: [M10, R0], value: [1, 5]}`,
optional `pulse_ms: [100, 0]`. Only `M` and `R`. A bit driven by a rung/sequence is refused.

**Read** – `/nextplc/state` (50 Hz, everything) or service `/nextplc/get_bits`.

**Force (commissioning)** – `/nextplc/force_bit {name: gpio1.di1, value: true}` forces a physical
input or output; `release: true` removes it. Refused in AUTO (parameter `allow_force_in_auto`).
Forced bits are flagged in `/nextplc/state`.

**Always true**
- Rungs run in file order every scan. A bit written by rung 3 is already the new value when rung 7
  reads it in the same scan.
- `out:` writes every scan. `set:`/`reset:` write only while their condition is 1.
- `RISE`/`FALL` last one scan and need to have seen the 0 first.
- Timers count real time from the scan clock: a 500 ms `ton` is 500 ms, not "50 scans".
- Only outputs written in the program are sent (section 13). A `Q` is sent to its controller only when it changes. If the controller does not echo it on
  `applied_commands` within 100 ms it is sent once more; still nothing → `S.IO_FAULT` = 1, a toast,
  and a retry every second. If something else switches an output the program owns, the program's
  value is sent again (the PLC owns the outputs it uses; the others stay free).
- Only `M` and `R` can be written from outside. `I` and `S` are read only. `Q` only through rungs.
- The hardware e-stop / STO chain stays in hardware. The PLC is for cell logic, not for safety.
