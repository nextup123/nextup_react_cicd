---
title: "nextplc - Soft PLC of the Nextup robot"
subtitle: "Complete manual: YAML programs, block library, simulator, rules, topics, services, BT nodes"
date: "2026-10-19 · nextplc 1.3"
---

# Part A – What nextplc is

## A.1 In one picture

```
 EtherCAT drives (joint1..6)  ──►  nextup_digital_input_broadcaster  ──►  /nextup_digital_inputs ─────────┐
 I/O module gpio1             ──►  nextup_gpio_command_controller    ──►  .../gpio_states ────────────────┤
 motion supervisor            ──►  /nextup_motion_supervisor/status ────────────────────────────────────┤
 BT / web UI                  ──►  /nextplc/set_bits  (M bits, R registers) ────────────────────────────┤
                                                                                                           ▼
                                                                                 ┌──────────────────────────────┐
                                                                                 │  nextplc_node                │
                                                                                 │  every 10 ms:                │
                                                                                 │   1. read inputs → I, S      │
                                                                                 │   2. run rungs, sequences    │
                                                                                 │   3. write changed Q         │
                                                                                 └──────────────────────────────┘
                                                                                                           │
   /nextup_digital_output_controller/commands  ◄── drive outputs joint1..6 do1,do2,do3,pi_p ──────────────┤
   /nextup_gpio_command_controller/commands    ◄── gpio1 do1..do8 ───────────────────────────────────────┤
   /nextplc/state (50 Hz)  /nextplc/alarms  /nextplc/program  /bt_toast_popup  ◄─────────────────────────┘
```

`nextplc` is a **soft PLC**: a program made of *rungs* (one line = one piece of logic) that runs
every 10 ms on the digital inputs and outputs of the robot. It is one ROS 2 node. **The Nextup
controllers are not changed** – the PLC only subscribes to their topics and publishes commands to
them, like the web UI or a terminal would.

The behaviour tree keeps doing what it does best – motion and the order of the job – and hands the
I/O logic to the PLC through virtual bits (`M`). The BT never switches a physical output itself.

## A.2 Vocabulary

| Word | Meaning |
|---|---|
| **scan** | one run of the whole program, every 10 ms |
| **rung** | one line of logic: `- {out: gpio1.do1, when: "gpio1.di1"}` |
| **image table** | the memory the rungs read and write (I, Q, M, R, S) |
| **I** | physical digital inputs (read only) |
| **Q** | physical digital outputs (written by rungs only) |
| **M** | virtual bits M0…M127 (rungs, BT, web) |
| **R** | registers R0…R31, whole numbers (rungs, BT, web) |
| **S** | system bits from the supervisor and the engine (read only) |
| **coil** | an `out:` rung – the output follows the condition every scan |
| **latch** | `set:` / `reset:` rungs – the bit remembers |
| **edge** | the moment a bit changes 0→1 (`RISE`) or 1→0 (`FALL`) |
| **sequence** | step logic: step 1, step 2, … one at a time |
| **safe state** | the value every controlled output takes in an emergency |
| **controlled output** | a Q that appears in the program; only those are touched by the PLC |
| **PLC emergency** | an `emergency:` rung fired: safe state + the supervisor's emergency service is called (E.10) |
| **block** | a tested piece of logic with ports (`cylinder`, `motor_starter` …) used by connecting addresses to it, Part J |
| **scenario** | a script for the simulator: inputs, models and expectations, Part K |

## A.3 Timing you must know

* Scan: 10 ms (parameter `scan_ms`, or `scan_ms:` in the program).
* Input → output: about 15–25 ms (DI topic 100 Hz + scan + DDS + 2 ms control cycle).
* Good for: interlocks, handshakes with the BT, lamps, counters, timers, cell sequences.
* **Not** for personnel safety. E-stop, STO and safety relays stay in hardware.

---

# Part B – Install, build, run

## B.1 Build

```bash
cd ~/NextupRobot
colcon build --symlink-install --packages-select nextplc
colcon build --symlink-install --packages-select control_logic_bt     # BT nodes SetBit, WaitBit, ...
source install/setup.bash
colcon test --packages-select nextplc control_logic_bt && colcon test-result --verbose | tail -3
```

## B.2 Files and folders

| What | Where |
|---|---|
| your program | `/home/nextup/user_config_files/plc/program.yaml` (parameter `program_file`) |
| retained registers | `/home/nextup/user_config_files/plc/retain.yaml` (written by the node) |
| node parameters | `~/NextupRobot/src/nextplc/config/nextplc.yaml` |
| example programs | `~/NextupRobot/src/nextplc/programs/first_test.yaml`, `example_cell.yaml`, `blink_cycle.yaml` + `.sim`, `cell_with_blocks.yaml` + `.sim` |
| block library | `~/NextupRobot/src/nextplc/blocks/*.yaml` (installed to `share/nextplc/blocks`); your own in `/home/nextup/user_config_files/plc/blocks/` |
| this manual | `~/NextupRobot/src/nextplc/doc/NEXTPLC_MANUAL.md` (short guides: `doc/LOGIC.md`, `BLOCKS.md`, `SIMULATOR.md`) |
| example tree | `~/NextupRobot/src/control_logic_bt/trees/plc_handshake_example.xml` |

## B.3 Run

```bash
mkdir -p /home/nextup/user_config_files/plc
cp ~/NextupRobot/src/nextplc/programs/first_test.yaml /home/nextup/user_config_files/plc/program.yaml
ros2 run nextplc nextplc_check /home/nextup/user_config_files/plc/program.yaml   # 1. check the file
ros2 launch nextplc nextplc.launch.py                                             # 2. run (robot stack running)
```

Start order: your normal stack first (controllers + supervisor), then the PLC. If the PLC starts
first it waits: *Outputs held in safe state: no fresh /nextup_digital_inputs* until the controllers
publish, then *Inputs and supervisor fresh again*.

Bench test without the robot stack: `ros2 run nextplc nextplc_node --ros-args -p require_supervisor:=false -p hold_on_stale_inputs:=false -p program_file:=/path/program.yaml`

Autostart: add `nextplc.launch.py` to `everything.launch.py` after `controllers.launch.py`.

## B.4 Change the program while running

```bash
nano /home/nextup/user_config_files/plc/program.yaml
ros2 run nextplc nextplc_check /home/nextup/user_config_files/plc/program.yaml
ros2 service call /nextplc/load_program nextplc/srv/LoadProgram "{path: ''}"
```

A file with any error is refused as a whole (`line N: …`); the old program keeps running. On a
successful reload: M and R keep their values, timers/edges/sequences start fresh, every controlled
output is written once.

---

# Part C – The image table and addresses

## C.1 The five areas

| Area | Addresses | Count | Who writes | Where it comes from / goes to |
|---|---|---|---|---|
| `I` | `joint1.di1` … `joint6.di8`, `gpio1.di1` … `gpio1.di8` | 56 | nobody (read only) | `/nextup_digital_inputs`, `/nextup_gpio_command_controller/gpio_states` |
| `Q` | `joint1.do1 do2 do3 pi_p` … `joint6.…`, `gpio1.do1` … `gpio1.do8` | 32 | rungs and sequences only | `/nextup_digital_output_controller/commands`, `/nextup_gpio_command_controller/commands` |
| `M` | `M0` … `M127` | 128 | rungs, sequences, BT, web | memory |
| `R` | `R0` … `R31` (int32) | 32 | rungs, BT, web | memory (`retain:` → disk) |
| `S` | `S.AUTO` … (table below) | 17 | the engine | `/nextup_motion_supervisor/status` + engine |

Drive inputs: `di1..di5` are the drive's digital inputs, `di6` = STO1, `di7` = STO2, `di8` = EDM.
Drive outputs: `do1 do2 do3` and `pi_p`. Addresses are **not case sensitive**: `M10` = `m10`,
`S.AUTO` = `s.auto`, `Joint1.DO3` = `joint1.do3`.

## C.2 System bits

| Bit | 1 when |
|---|---|
| `S.AUTO` / `S.SAFEAUTO` / `S.JOG` | the supervisor profile is AUTO / SAFEAUTO / JOG |
| `S.ARMED` | the supervisor passes motion commands to the drives |
| `S.EMERGENCY` | an emergency is latched – **also** when the supervisor status is missing (`require_supervisor`) |
| `S.ESTOP` | the hardware e-stop input is pressed |
| `S.STANDSTILL` | every joint stands still |
| `S.ANY_FAULT` | a drive reports a fault |
| `S.IO_FAULT` | an output was not applied by its controller, or the inputs are stale |
| `S.DI_OK` | both input topics are fresh (younger than `di_timeout_ms`) |
| `S.SUPERVISOR_OK` | the supervisor status is fresh (younger than `supervisor_timeout_ms`) |
| `S.FIRST_SCAN` | only in the first scan after a program load |
| `S.BLINK_1HZ` / `S.BLINK_2HZ` | toggles every 500 ms / 250 ms (lamps) |
| `S.PROGRAM_OK` | a program is loaded and running |
| `S.SAFE_STATE` | the controlled outputs are held in their safe state |
| `S.PLC_EMERGENCY` | an `emergency:` rung of the program fired and the supervisor has not yet confirmed the emergency (E.10) |

## C.3 Sequence values (read only, see Part F)

`seq.<name>.step` (number: 0 = idle, 1..n), `seq.<name>.active` (bit), `seq.<name>.<stepname>` (bit:
1 while that step runs).

## C.4 How the engine runs one scan

```
every 10 ms
  1. S bits:  FIRST_SCAN, BLINK_1HZ, BLINK_2HZ, PROGRAM_OK (DI_OK, SUPERVISOR_OK, EMERGENCY from the node)
  2. I:       the latest topic values; a forced input wins over the real one
  3. pulses:  an M bit set with pulse_ms goes back to 0 when its time is over
  4. rungs:   top to bottom, in file order
  5. sequences: in file order (an emergency puts every sequence to idle)
  6. alarms:  0→1 and 1→0 edges of the alarm bits are published
  7. Q:       physical value = image Q, or the safe value (emergency / PLC emergency / no program / hold),
              except exempt outputs; a forced output wins over everything;
              only CONTROLLED outputs are sent, and only when they changed
```

**Rule:** a bit written by rung 3 already has its new value when rung 7 reads it in the same scan.
A rung that reads `seq.x.step` sees the step of the previous scan (sequences run after the rungs).

---

# Part D – The program file

## D.1 Skeleton

```yaml
program: cell1              # name (shown in the log and in /nextplc/state)
scan_ms: 10                 # optional, 1..1000; overrides the node parameter

io:                         # optional names (aliases), by area
  I: {part_present: gpio1.di4}
  Q: {clamp: gpio1.do3}
  M: {at_p1: M10}
  R: {part_count: R0}
names: {start_button: gpio1.di7}     # optional flat form, area taken from the address

retain: [R0, part_count]    # registers saved to disk on change, restored at start

safe_state:                 # values of the CONTROLLED outputs in an emergency (default all 0)
  default: 0
  gpio1.do1: 1
  exempt: [gpio1.do7]       # these keep following the rungs even in the safe state

rungs:                      # Part E
  - {out: gpio1.do1, when: "gpio1.di1"}

sequences:                  # Part F
  - name: seq1
    start: "S.AUTO AND RISE(gpio1.di7)"
    abort: "S.EMERGENCY"
    steps:
      - {name: s1, do: [gpio1.do2], next: "gpio1.di2", timeout: 2s, on_timeout: M30}

alarms:                     # Part G
  - {bit: M30, text: "gpio1.di2 did not come", level: error, toast: true}
```

Allowed top-level keys: `program scan_ms io names retain safe_state blocks rungs sequences alarms`
(`blocks:` = library blocks, Part J).
Anything else is an error (typo protection). A program needs at least one rung or one sequence.

## D.2 Every key, one table

| Section | Key | Type | Meaning |
|---|---|---|---|
| top | `program` | text | name |
| top | `scan_ms` | 1..1000 | scan cycle |
| `io` | `I:` `Q:` `M:` `R:` | map alias→address | the address must be in that area |
| `names` | alias: address | map | area from the address |
| `retain` | list | R addresses/aliases | saved to `retain.yaml` |
| `safe_state` | `default` | 0/1 | safe value of every controlled Q |
| `safe_state` | `<Q>` | 0/1 | safe value of one output |
| `safe_state` | `exempt` | list of Q | follow the rungs even in the safe state |
| `blocks` | `use` / `as` / `with` | block name, instance name, map port: address | a library block (Part J) |
| rung | `out` | Q or M | coil |
| rung | `set` / `reset` | Q or M | latch |
| rung | `toggle` | Q or M | flip on each rising edge of `when` |
| rung | `when` | expression | condition (required except for `count`; optional for `move`/`calc` = always) |
| rung | `ton` / `tof` / `tp` | time **or register** | timer on an `out:` rung, one per rung. `ton: 500ms`, or `ton: R10` = the time in ms read from R10 every scan (E.4) |
| rung | `count` | R | counter register |
| rung | `up` / `down` | expression | count +1 / −1 on each rising edge |
| rung | `reset` (in count) | expression | count = 0 while 1 |
| rung | `preset` | number or expression | `done` = count ≥ preset |
| rung | `done` | Q or M | optional done bit (needs `preset`) |
| rung | `move` + `value` | R, expression | R = value while `when` |
| rung | `calc` | `"R2 = R0 * 2 + R1"` | R = formula while `when` |
| rung | `emergency` + `text` | expression, text | rising edge of the expression → robot emergency stop (E.10) |
| sequence | `name` | text | unique; no `.` |
| sequence | `start` | expression | idle → step 1 |
| sequence | `abort` | expression | optional: running → idle |
| step | `name` | text | unique in the sequence; not `step`/`active` |
| step | `do` | list of Q/M | 1 while the step runs |
| step | `next` | expression | transition to the next step (last step → idle) |
| step | `timeout` + `on_timeout` | time, bit | both or none |
| alarm | `bit` | any bit | the alarm bit |
| alarm | `text` | text | shown in the toast / log |
| alarm | `level` | info / warning / error | default error |
| alarm | `toast` | true/false | default true |

## D.3 Times and numbers

* Times always have a unit: `300ms`, `2s`, `1.5s`, `1min`. `ton: 300` is an error.
* A time may also come from a register, in **milliseconds**: `ton: R10`, `ON_FOR(gpio1.di1, R10)`,
  `next: "ON_FOR(TRUE, R10)"`. The register is read every scan, so the web UI or the BT can change
  the time while the program runs (`set_bits R10 1500`). An alias works too (`ton: blink_time`).
* Numbers are whole numbers (int32): `10`, `-3`. `1.5` is an error (use a time like `1.5s` where a
  time is expected).
* A bit used as a number counts 0 / 1; a number used as a condition is an error – write `R0 > 0`.

---

# Part E – Rungs, explained like a teacher

Every example below uses raw addresses. Replace them with your own.

## E.1 Coil – `out:`

```yaml
- {out: gpio1.do1, when: "gpio1.di1"}
```
Every scan: look at `gpio1.di1`. If it is 1, write 1 to `gpio1.do1`. If it is 0, write 0. The output
follows the input, always. A relay contact and a coil.

```yaml
- {out: joint6.do2, when: "gpio1.di1 AND M10"}          # series: both must be 1
- {out: joint6.do2, when: "gpio1.di1 OR M10"}           # parallel: one is enough
- {out: joint6.do2, when: "gpio1.di1 AND NOT gpio1.di2"} # NOT = normally-closed contact
- {out: M20, when: "(gpio1.di1 OR gpio1.di2) AND S.AUTO"} # brackets like in maths; output is a virtual bit
```

Time picture of a coil:
```
gpio1.di1  ___|¯¯¯¯¯¯¯¯|_____|¯¯|___
gpio1.do1  ___|¯¯¯¯¯¯¯¯|_____|¯¯|___      follows at once (next scan), remembers nothing
```

**Rules**
* A coil writes 1 **and** 0, every scan. The moment the condition is false the output is 0.
* A Q or M bit has exactly **one** `out:` (or `toggle:`) rung. A second one is a load error:
  *line 7: gpio1.do1 is already written by rung 2 (out, line 4) (one owner per bit)*.

## E.2 Latch – `set:` / `reset:`

```yaml
- {set:   M21, when: "gpio1.di3"}
- {reset: M21, when: "gpio1.di4"}
```
Line 1: while `gpio1.di3` is 1, `M21` becomes 1. When `gpio1.di3` goes back to 0, `M21` **stays** 1.
Line 2: while `gpio1.di4` is 1, `M21` becomes 0. It stays 0 until line 1 sets it again.

```
gpio1.di3  __|¯¯|______________|¯¯|____
gpio1.di4  __________|¯¯|______________
M21        __|¯¯¯¯¯¯¯¯¯|_______|¯¯¯¯¯¯¯¯  remembers
```

**Rules**
* Both conditions 1 in the same scan → the rung **lower in the file wins**. Put the one that must win
  last (usually the reset).
* A bit may have many `set:`/`reset:` rungs, but then no `out:`/`toggle:` rung and no sequence `do:`.
* The BT may also set/reset such a bit with `SetBit` (it may not touch a bit that has an `out:` rung).

Use for: a latched alarm, "machine started", "part is inside".

## E.3 Edges – `RISE()` / `FALL()`

```yaml
- {out: M22, when: "RISE(gpio1.di5)"}
```
`RISE(x)` is 1 for **one scan** (10 ms) at the moment `x` goes 0→1, then 0 again even if `x` stays 1.
`FALL(x)` is the same for 1→0.

```
gpio1.di5  ____|¯¯¯¯¯¯¯¯¯¯¯¯|________
RISE       ____|¯|___________________     one scan
FALL       _________________|¯|______
```

**Rules**
* An edge must **see the 0 first**. If `gpio1.di5` is already 1 when the program is loaded (or when a
  sequence step is entered), that is **not** an edge. No false counts at start-up.
* Use edges for counting, push buttons, "start once", one-shot moves.

## E.4 Timers – `ton:` `tof:` `tp:` and `ON_FOR()` `OFF_FOR()`

**On delay – TON**
```yaml
- {out: gpio1.do2, when: "gpio1.di1", ton: 500ms}
```
`gpio1.di1` goes 1 → counting starts. After 500 ms **without a break**, `gpio1.do2` = 1. A break
restarts the count from zero. When `gpio1.di1` goes 0, `gpio1.do2` goes 0 at once.
```
gpio1.di1  __|¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯|____|¯¯|_______
gpio1.do2  _______|¯¯¯¯¯¯¯¯¯¯|___________________   on after 500 ms; the short pulse never reaches 500 ms
              |500ms|
```
Use: sensor debounce, "wait a moment after the part arrives".

**Off delay – TOF**
```yaml
- {out: gpio1.do3, when: "M10", tof: 2s}
```
`M10` goes 1 → `gpio1.do3` = 1 **at once**. `M10` goes 0 → `gpio1.do3` **stays** 1 for 2 s, then 0.
If `M10` comes back within the 2 s the output never went off.
```
M10        __|¯¯¯¯¯¯|________________
gpio1.do3  __|¯¯¯¯¯¯¯¯¯¯¯¯¯¯|________
                    |  2 s  |
```
Use: keep a lamp or blower on a little longer.

**Pulse – TP**
```yaml
- {out: gpio1.do4, when: "RISE(M11)", tp: 300ms}
```
When the condition becomes 1, `gpio1.do4` is 1 for **exactly** 300 ms, then 0, whatever the condition
does meanwhile. A new trigger during the pulse is ignored.
```
M11        __|¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯|_____
gpio1.do4  __|¯¯¯¯¯¯|_______________
             | 300ms|
```
Use: horn beep, "ready" pulse to a machine, reset pulse.

**"has been 1 for …" inside a condition – ON_FOR / OFF_FOR**
```yaml
- {set: M23, when: "ON_FOR(gpio1.do1 AND NOT gpio1.di1, 2s)"}
```
Reads: "`gpio1.do1` is 1 and `gpio1.di1` is 0, and that has been true for 2 s continuously" → set
`M23`. The classic feedback check: output commanded, sensor never came. `OFF_FOR(x, 2s)`: `x` has
been 0 for 2 s.

**Time from a register (changeable at run time)**
```yaml
- {move: R10, value: 500, when: "S.FIRST_SCAN AND R10 == 0"}   # default 500 ms, keeps a retained value
- {out: gpio1.do2, when: "gpio1.di1", ton: R10}                # on delay = R10 milliseconds
- {out: gpio1.do3, when: "ON_FOR(gpio1.di1, R10)"}             # the same inside a condition
```
`R10` holds the time in **milliseconds** and is read in every scan: `set_bits R10 1500` from the web
or the BT changes the delay to 1.5 s for the next cycle. Put `R10` in `retain:` and it survives a
restart. A value ≤ 0 means "no delay". Any register, alias or number expression is allowed
(`ton: R10 * 2`), but not a bit.

**Rules**
* `ton:`/`tof:`/`tp:` only on `out:` rungs, one per rung.
* Timers count real time (the scan clock). A 500 ms TON is 500 ms, not "50 scans".
* A program reload resets all timers.

## E.5 Counter – `count:`

```yaml
- {count: R0, up: "RISE(gpio1.di6)", reset: "RISE(gpio1.di7)", preset: 10, done: M24}
```
Each 0→1 of `gpio1.di6`: `R0` + 1. 0→1 of `gpio1.di7`: `R0` = 0. While `R0 >= 10`, `M24` = 1.

```
gpio1.di6  _|¯|__|¯|__|¯|__|¯¯¯¯¯¯|___
R0          0  1    2    3    4           held input = one count only
```

```yaml
- {count: R1, up: "gpio1.di6", down: "gpio1.di5", preset: R2}        # down counts -1; preset from a register
- {count: R3, up: "RISE(M13)"}                                        # no preset: just counts
```

**Rules**
* `up:`/`down:` count **edges** themselves: `up: "gpio1.di6"` and `up: "RISE(gpio1.di6)"` do the same.
* `reset:` is a **level**: while 1 the count stays 0.
* `done:` needs `preset:`; `done` belongs to this rung (one owner).
* The register **is** the counter. The BT or the web may write it (`SetRegister R0 = 0`); the rung
  continues from there. `move:`/`calc:` may **not** write a count register (load error).
* One `count:` rung per register.

## E.6 Numbers – `move:` `calc:` and comparisons

```yaml
- {move: R1, value: 3, when: "RISE(gpio1.di8)"}      # at the edge: R1 = 3, then keeps 3
- {move: R4, value: R0, when: "M5"}                  # while M5: R4 copies R0 every scan
- {calc: "R2 = R0 * 2 + R1"}                         # every scan (no when = always)
- {calc: "R6 = (R0 - R1) / 2", when: "S.AUTO"}
- {out: M25, when: "R0 >= R2 AND S.AUTO"}
- {out: M26, when: "R1 == 3 OR R1 = 7"}              # = and == both mean "equal"
```

Operators: `+ - * / %`, brackets. Division by zero gives 0 (never a crash). Comparisons:
`== != < <= > >=`. A bit in arithmetic counts 0 / 1 (`R1 + M5`).

**Rules**
* `move`/`calc` run **every scan while `when` is 1** (level). For "once", use `RISE(...)` in `when`.
* Many `move`/`calc` rungs may write the same register (the lowest in the file wins when both run).
* Registers are int32; results are clamped to that range.

## E.7 Toggle – `toggle:`

```yaml
- {toggle: gpio1.do5, when: "gpio1.di1"}
```
Each 0→1 of the condition flips `gpio1.do5`: 0→1, next time 1→0. Holding the button does not flip
again. One owner, like a coil.

## E.8 System bits in rungs

```yaml
- {out: gpio1.do6, when: "S.AUTO AND NOT S.EMERGENCY"}      # green lamp
- {out: gpio1.do7, when: "S.EMERGENCY AND S.BLINK_1HZ"}     # red lamp blinks in an emergency
- {move: R5, value: 1, when: "S.FIRST_SCAN"}                # initial value after a load
- {out: M27, when: "S.JOG OR S.SAFEAUTO"}                   # "manual mode" bit for other rungs
```
For `gpio1.do7` to blink **during** the emergency it must be in `safe_state.exempt` (Part H).

## E.9 Which outputs belong to the PLC

Only the Q that are **written** in the program (`out:`, `set:`/`reset:`, `toggle:`, `done:`, sequence
`do:`) are controlled by the PLC. Every other DO is never sent: the BT `DoControl`/`GpioDoControl`
nodes, the web UI and `ros2 topic pub` keep using it as before.

```yaml
rungs:
  - {out: joint1.do3,   when: "joint1.di1 OR joint1.di3"}
  - {set:   joint3.do1, when: "joint2.di2"}
  - {reset: joint3.do1, when: "joint1.di1"}
```
Controlled: `joint1.do3`, `joint3.do1` (log: *controls 2 of 32 outputs, the others stay free*).
Free: `joint2.do1`, `gpio1.do1…do8`, every `pi_p`, … `/nextplc/state` shows it per output in
`q_controlled`.

A controlled output: written once at load, sent on change, re-sent if something else switches it
(the program wins), safe value in the safe state. A free output: nothing of that. If a reload
removes an output from the program it is written 0 one last time, then left alone.

Parameter `control_unused_outputs: true` → the PLC owns all 32 (unused ones held at their safe
value).

## E.10 Emergency – `emergency:`

```yaml
- {emergency: "NOT gpio1.di5 AND S.AUTO AND S.ARMED", text: "Door opened while running"}
```

Reads: "the moment `gpio1.di5` is 0 while the robot is in AUTO and armed → **emergency stop of the
robot**". This is the only rung that reaches outside the PLC: it calls the supervisor's service
`/nextup_motion_supervisor/trigger_emergency` (`std_srvs/Trigger`), the same service the e-stop
handling and the web UI use. The drives stop the way the supervisor always stops them; nothing in the
controllers changes.

What happens, scan by scan:

1. The condition goes 0 → 1 (**rising edge**; a condition that stays 1 fires once, not every scan).
2. In the same scan the PLC latches `S.PLC_EMERGENCY` = 1: every controlled output goes to its
   `safe_state` value (exempt outputs keep following their rungs), every sequence goes to idle, the
   rungs keep running (M, R, lamps).
3. The node calls the service. Log: `EMERGENCY from the program: Door opened while running (rung 9
   (emergency, line 31)) -> /nextup_motion_supervisor/trigger_emergency, outputs to safe state`; an
   `Alarm` with `bit: S.PLC_EMERGENCY, level: error, active: true` on `/nextplc/alarms`; a toast
   `PLC EMERGENCY: Door opened while running,failure,10`.
4. If the service is not available or answers failure, the call is repeated every second
   (`emergency_retry_ms`) and the outputs **stay** in the safe state meanwhile.
5. The supervisor reports `emergency_latched` → `S.EMERGENCY` = 1. The PLC latch is handed over:
   `S.PLC_EMERGENCY` goes 0 (alarm `active: false`), the safe state now follows `S.EMERGENCY` like any
   other emergency. The operator resets with the normal `reset_fault` of the supervisor; when
   `S.EMERGENCY` goes 0 the outputs follow the rungs again.
6. A program reload also clears the PLC latch. The condition must go 0 and 1 again for a new request.

Rules:
* `emergency:` has no `when:` – the condition **is** the value. `text:` is optional (default `PLC
  emergency (rung N)`). The condition must be a bit, like every condition.
* Several `emergency:` rungs are allowed; each one has its own text.
* The PLC emergency is a **functional** stop through software (topic → service → supervisor). The
  hardware e-stop, STO and safety relays stay the safety chain; this rung does not replace them.
* Parameters: `emergency_service` (default the supervisor service, `""` = safe state only, no call),
  `emergency_retry_ms` (1000).

---

# Part F – Sequences (step logic)

For things that happen **in order**, write steps instead of many set/reset rungs (SFC / GRAFCET
style).

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
rungs:
  - {out: gpio1.do8, when: "seq.seq1.s2 OR seq.seq1.s3"}
  - {reset: M30, when: "RISE(gpio1.di8)"}
```

How it runs:

1. Idle (step 0) until `start` is 1: AUTO **and** a rising edge on `gpio1.di7` → step **s1**.
2. **s1**: `do` is empty → all bits the sequence owns (`gpio1.do1`, `M11`, `M14`) are 0. Waits for
   `gpio1.di1` = 1 → **s2**.
3. **s2**: `gpio1.do1` = 1. Waits for `gpio1.di2`. More than 2 s → `M30` = 1 (latched, reset it with a
   rung), sequence → idle, outputs 0.
4. **s3**: `gpio1.do1` stays 1, `M11` = 1 (the BT waits on `M11`, does its motion). Waits for `M13`
   (the BT sets it).
5. **s4**: `gpio1.do1` = 0, `M11` = 0. Waits for `gpio1.di2` = 0.
6. **s5**: `M14` = 1 for one scan, `next: TRUE` → idle in the next scan.
7. Any time `abort` is 1 → idle, all owned outputs 0.

```
step        0 | 1 (s1) | 2 (s2)        | 3 (s3)       | 4 (s4) | 5 | 0
gpio1.do1   0 | 0      | 1             | 1            | 0      | 0 | 0
M11         0 | 0      | 0             | 1            | 0      | 0 | 0
M14         0 | 0      | 0             | 0            | 0      | 1 | 0
gpio1.do8   0 | 0      | 1 (one scan late) | 1        | 0      | 0 | 0
```

**Rules**
* A step is entered in one scan and its outputs are written at once; its `next` is checked from the
  **next** scan on. Edge/timer memory inside `next` is reset on entry (no old edge).
* `start` and `abort` are evaluated every scan (so a `RISE` inside stays current), but `start` acts
  only when idle and `abort` only when running.
* Rungs run before sequences: a rung reading `seq.seq1.s2` is one scan (10 ms) late.
* An emergency puts every sequence to idle, even without `abort:`.
* Ownership: a bit in a `do:` belongs to the sequence – no `out:`, `toggle:`, `set:`, `reset:` for it.
  `on_timeout` bits are "set"-type: they may share with set/reset rungs.
* `timeout` and `on_timeout` come together. A step without `timeout` waits forever (until `abort`).
* Readable from rungs: `seq.seq1.step` (0..n), `seq.seq1.active`, `seq.seq1.s2` …
* Two things in parallel = two sequences. A branch = a second sequence waiting on a bit the first sets.

## F.1 What the engine does with a sequence, every scan

1. **Idle (step 0).** `start` is evaluated. The scan it becomes 1, step 1 is entered: the `do:` bits
   of step 1 are written in that same scan; the `next` of step 1 is checked from the following scan.
2. **In a step.** `abort` is 1 → idle at once, all owned bits 0. Otherwise `next` of the current
   step is evaluated: 1 → the following step is entered (after the last step → idle). Else, if the
   step has a `timeout` and has lasted that long → `on_timeout` = 1, sequence → idle.
3. **Outputs.** Every bit that appears in any `do:` of the sequence is written 0, then the bits of
   the current step are written 1. A bit is 1 exactly while its step runs, never otherwise.
4. On entry the edge/timer memory of the step's `next` is cleared: a `RISE()` counts only an edge
   that happens after entering, an `ON_FOR()` starts counting at entry.

`do:` = *what is ON during the step*. `next:` = *what ends the step*. The engine never "does"
anything else in a step – everything is level logic, like the rungs.

## F.2 What to write in `next:`

`next:` is a condition – the same language as `when:` (Part I). Every form answers "when may this
step end?" differently:

| `next:` | Meaning |
|---|---|
| `"ON_FOR(TRUE, 2s)"` | fixed wait: `TRUE` is always 1, `ON_FOR` measures how long it has been 1, the timer is cleared on entry → "stay 2 s in this step" |
| `"ON_FOR(TRUE, R10)"` | the same, time from a register in ms (changeable from the web / BT) |
| `"gpio1.di2"` | wait until the input is 1 (already 1 at entry → the step lasts one scan) |
| `"NOT gpio1.di2"` | wait until it is 0 |
| `"RISE(gpio1.di2)"` | wait for a 0→1 **event** after entering; an input already 1 at entry does not count |
| `"ON_FOR(gpio1.di2, 300ms)"` | the input has been stable 1 for 300 ms (debounce, "really closed") |
| `"OFF_FOR(gpio1.di2, 1s)"` | stable 0 for 1 s |
| `"RISE(M13)"` | handshake with the BT: the BT does `PulseBit M13` when its part is done |
| `"M13 AND gpio1.di2"`, `"… OR …"` | several things together / either one |
| `"R0 >= R10"` | wait until a counter reached a value |
| `"seq.s2.active"` / `"NOT seq.s2.active"` | wait for another sequence to run / to finish |
| `"S.STANDSTILL"` | wait for the robot to stand still |
| `"TRUE"` | leave in the next scan: a 10 ms step, useful as a one-scan flag |
| `"FALSE"` | never leaves by itself: only `abort` or `timeout` ends the step |

## F.3 Patterns

**Robot handshake (BT ↔ PLC)**
```yaml
- {name: ask, do: [M11], next: "RISE(M13)", timeout: 30s, on_timeout: M30}
```
BT: `WaitBit M11` → move → `PulseBit M13`. No answer in 30 s → `M30` = 1 and the sequence stops.
`- {reset: M30, when: "RISE(gpio1.di8)"}` is the operator reset.

**Repeat while a condition holds.** A level `start` restarts the sequence one scan after it ends:
`start: "joint1.di1"` cycles as long as `joint1.di1` is 1; `start: "RISE(joint1.di1)"` runs exactly
one cycle per 0→1.

**Count cycles, stop after N**
```yaml
- {count: R5, up: "FALL(seq.s1.active)", reset: "RISE(gpio1.di8)"}   # +1 per finished cycle
```
and `start: "joint1.di1 AND R5 < 10"`.

**Skip a step by condition.** A step cannot jump, but it can last 10 ms: `next: "NOT M40 OR
joint1.di3"` – with `M40` = 0 the step passes through at once, with `M40` = 1 it waits for `di3`.

**Branch (two paths).** Two sequences with exclusive starts: `start: "RISE(M50) AND M41"` and
`start: "RISE(M50) AND NOT M41"`; a rung decides `M41` before.

**Chain A → B.** Make the last step of A a flag step `{name: done, do: [M20], next: "TRUE"}` and
give B (written after A in the file) `start: "M20"`. `M20` is 1 for exactly one scan at the end of
A, B sees it in that scan (sequences run in file order). An abort of A never sets `M20`.

**Parallel actions.** Two sequences started by the same condition run side by side; each owns its own
bits.

**Abort and restart safely.** Put everything that must stop the cycle in `abort:` (`S.EMERGENCY OR
NOT S.AUTO OR M30`). On abort every `do:` bit goes 0 at once; what must stay on in a safe way goes in
`safe_state`.

**Step time changeable at run time.** `next: "ON_FOR(TRUE, R10)"` with `R10` retained and written
from the web (`set_bits R10 1500`).

**Something ON while the sequence does NOT run** (idle output): a rung, not a step –
`- {out: joint1.do1, when: "NOT seq.s1.active"}`. If the same output must also be 1 in one step, let
the step drive a helper `M` bit and write `- {out: joint1.do1, when: "NOT seq.s1.active OR M100"}`.


---

# Part G – Alarms

```yaml
alarms:
  - {bit: M30, text: "gpio1.di2 did not come within 2 s", level: error, toast: true}
  - {bit: M24, text: "Batch finished",                       level: info,  toast: true}
  - {bit: S.IO_FAULT, text: "PLC output not applied / inputs stale", level: error, toast: false}
```

* On the 0→1 edge of the bit: one message on `/nextplc/alarms` (`active: true`), a log line, and
  with `toast: true` a web-UI toast on `/bt_toast_popup` (`<text>,failure,10` for error/warning,
  `<text>,success,10` for info).
* On the 1→0 edge: `/nextplc/alarms` with `active: false` (no toast).
* The alarm bit is a normal bit: latch it and reset it with rungs.

---

# Part H – Safe state, names, retain

## H.1 Safe state

```yaml
safe_state:
  default: 0
  gpio1.do1: 1
  exempt: [gpio1.do7]
```
The **controlled** outputs go to their safe value when
* `S.EMERGENCY` is 1 (also while the supervisor status is missing),
* no program is loaded (load error at start) – then everything controlled is 0,
* the input topics are stale (`hold_on_stale_inputs`),
* the node stops.

Rungs and sequences keep running (M and R keep working), but what they write to a non-exempt Q is
not sent while the safe state is active. `exempt` outputs follow the rungs even then (lamps, horn).
When the emergency is reset the outputs follow the rungs again at once. Sequences are put to idle by
an emergency.

In an expression, `gpio1.do1` is the value the **logic** wants; the physical value can differ in the
safe state (`/nextplc/state`: `logic_q` vs the Q entries of `bit_values`).

## H.2 Names (aliases)

```yaml
io:
  I: {part_present: gpio1.di4}
  Q: {clamp: gpio1.do3}
  M: {at_p1: M10}
  R: {part_count: R0}
names: {start_button: gpio1.di7}
rungs:
  - {out: clamp, when: "part_present AND at_p1"}
```
A name is just another way to write the address: letters, digits, `_`; not a raw address, not a
keyword (`and or not true false rise fall on_for off_for`), not starting with `seq.`/`S.`, unique. The
BT, the web UI and the services accept the name or the address. `/nextplc/state` publishes the alias
table (`alias_names` / `alias_targets`) so the monitor can show both.

## H.3 Retained registers

```yaml
retain: [R0, R2]
```
Written to `retain.yaml` when they change, restored at the next start. Everything else starts at 0.
Only registers can be retained.

---

# Part I – The expression language (complete reference)

An expression is the text after `when:`, `up:`, `down:`, `reset:`, `start:`, `abort:`, `next:`, the
right side of `calc:`, and `value:`/`preset:`.

| Write | Meaning | Result |
|---|---|---|
| `gpio1.di1`, `M10`, `S.AUTO`, alias | the bit | bit |
| `R0`, `seq.s.step`, `5`, `-3` | the number | number |
| `NOT a`, `!a` | normally-closed contact | bit |
| `a AND b`, `a && b` | series | bit |
| `a OR b`, `a \|\| b` | parallel | bit |
| `( … )` | grouping | – |
| `RISE(a)`, `FALL(a)` | one scan at 0→1 / 1→0 | bit |
| `ON_FOR(a, 500ms)`, `OFF_FOR(a, 2s)` | a has been 1 / 0 for at least that long | bit |
| `ON_FOR(a, R10)`, `OFF_FOR(a, blink_time)` | the same, the time in milliseconds from a register / alias / number expression, read every scan | bit |
| `x == y`, `x = y`, `x != y`, `x < y`, `x <= y`, `x > y`, `x >= y` | compare numbers (bits count 0/1) | bit |
| `x + y`, `x - y`, `x * y`, `x / y`, `x % y`, `-x` | arithmetic (int32, /0 → 0) | number |
| `TRUE`, `FALSE` | constants | bit |

**Precedence** (lowest first): `OR` < `AND` < `NOT` < comparisons < `+ -` < `* / %` < unary `-`.
So `M1 OR M2 AND M3` = `M1 OR (M2 AND M3)`, and `NOT R0 > 5` = `NOT (R0 > 5)`. Use brackets when in
doubt.

**Type rules**: `AND`/`OR`/`NOT`/`RISE`/`FALL`/`ON_FOR`/`OFF_FOR` need bits – a number there is an
error (*R0 AND M1: AND needs a bit (use a comparison for a number, e.g. R0 > 0)*). A condition
(`when:` etc.) must be a bit. `value:`/`preset:` and the right side of `calc:` are numbers (a bit is
0/1).

**Keywords are not case sensitive**: `and`, `AND`, `And` are the same.

**Edge/timer memory lives inside the expression**, so the same `RISE(gpio1.di1)` written in two rungs
is two independent edge detectors (both fire in the same scan).

---

# Part J – The block library

A **block** is a piece of logic that has been written once, tested in the simulator, and can be used
in any program by connecting its **ports** to your addresses – like a function block in a PLC, or a
relay module you wire into a panel. A cylinder with two end sensors, a motor starter with contactor
feedback, a two-hand start, a lamp tower: most cells are 80 % such blocks and 20 % cell-specific
rungs.

Blocks do not add anything to the engine: when the program loads, the block's rungs are copied into
your program with the port names replaced by your addresses. `nextplc_check` shows exactly what was
expanded, and every rule of the manual (one owner per bit, safe state, controlled outputs …)
applies to the expanded rungs like to your own.

## J.1 Using a block

YAML:
```yaml
blocks:
  - use: cylinder                  # blocks/cylinder.yaml
    as: clamp                      # the instance name (prefix for its internal bits: clamp.busy)
    with:                          # port -> what you connect to it
      request:     M10
      extend_cmd:  gpio1.do1
      extended:    gpio1.di2
      retracted:   gpio1.di3
      fault:       M30
      reset:       gpio1.di8
      travel_time: 2s
rungs:
  - {out: gpio1.do6, when: "clamp.in_position AND NOT clamp.busy"}
```

Rules:

* `use:` is the block name = its file name without `.yaml`. It is looked up in `<folder of your
  program>/blocks/`, then the node parameter `block_dirs` (default `/home/nextup/user_config_files/plc/blocks`),
  then the installed library (`share/nextplc/blocks`). A full path works too.
* `as:` is the instance name: letters, digits, `_`; unique in the program. Without `as:` the block
  name is used (so one instance per block).
* Every port that is not **optional** and has no **default** must be connected. The kinds:

| kind | you connect | example |
|---|---|---|
| `in` | any bit the block reads (I, Q, M, S) or `TRUE` / `FALSE` | `extended: gpio1.di2` |
| `out` | a Q or M bit the block **writes** – it belongs to the block (one owner per bit) | `extend_cmd: gpio1.do1` |
| `register` | an R register | `count: R0` |
| `time` | `500ms`, `2s`, or a register (or its alias) holding milliseconds | `travel_time: 2s` |
| `number` | a whole number or a register (or its alias) | `preset: batch_size` |

* An alias (`names:` / `NAME`) is accepted everywhere an address is.
* **Open optional ports**: an `in` reads 0, an `out` gets a private M bit (nobody else sees it).
* **Locals** (the block's internal bits, e.g. `busy`, `in_position`) get free M bits from `M127`
  downwards and registers from `R31` downwards – never one your program mentions. You can read
  them as `<as>.<local>` (`clamp.busy`) in your rungs, the web UI (`/nextplc/state`
  shows them under that name) and `get_bits`. To pin one to an address of your choice:
  `with: {busy: M50}`.
* Ports can also be read as `<as>.<port>` (`clamp.extend_cmd` = `gpio1.do1`).
* A sequence inside a block is called `<as>_<name>` (`clamp_cycle`), readable as `seq.clamp_cycle.step`.
* An error inside the block names everything: `line 4: block 'cylinder' (as clamp),
  blocks/cylinder.yaml line 31: …` – line 4 is the line of the instance in your program.
* The log says `loaded cell1: 24 rungs, 0 sequences, 4 alarms, 5 blocks; …` and `nextplc_check`
  lists each instance with its ports, locals and the rung numbers it occupies.

## J.2 The library (`blocks/`)

Every block below has its own scenario in `blocks/tests/` and is run by `colcon test` (`test_blocks`).
Read the head of each file for the full port list; this is the summary.

| Block | What it does | Ports (in / **out** / time) |
|---|---|---|
| `cylinder` | double-acting cylinder with two end sensors: valve follows `request`, `fault` latched when the sensor does not come within `travel_time`, valve released on fault, `reset` edge clears | `request`, `extended`, `retracted`, `reset`?, **`extend_cmd`**, **`fault`**, `travel_time` 2s; locals `busy`, `in_position` |
| `two_hand_start` | both buttons within `window` of each other and held; one held alone longer than the window blocks until both are released | `left`, `right`, `enable` (default TRUE), **`output`**, `window` 500ms |
| `motor_starter` | start edge / stop level, contactor feedback must follow the command within `fb_time` both ways, latched `fault`, `reset` | `start`, `stop_ok`, `running_fb` (default = the command), `reset`?, **`run_cmd`**, **`fault`**, `fb_time` 1s |
| `conveyor` | motor follows `run_request`; while running the part sensor must change state every `jam_time`, else the belt stops and `fault` is latched | `run_request`, `part_sensor`, `reset`?, **`motor`**, **`fault`**, `jam_time` 5s |
| `tower_lamp` | green = AUTO and no fault; yellow = warning or not AUTO; red blinks 1 Hz on fault / emergency; buzzer for `buzzer_time` or until `ack` | `fault`, `warning`?, `ack`?, **`green`**, **`yellow`**, **`red`**, **`buzzer`**?, `buzzer_time` 3s |
| `debounce` | clean copy of a noisy input: 1 after `on_time` stable 1, 0 after `off_time` stable 0 | `input`, **`output`**, `on_time` 50ms, `off_time` 50ms |
| `part_counter` | counts rising edges into a **retained** register, `done` while count ≥ `preset`, `reset` edge → 0 | `count_input`, `reset`?, `count` (register), `preset` (number), **`done`**? |
| `bt_handshake` | `start` edge raises `request` (BT: `WaitBit`), a pulse on `done` (BT: `PulseBit`) clears it; no answer within `timeout` → `fault` | `start`, `done`, `reset`?, **`request`**, **`fault`**, `timeout` 30s |
| `door_guard` | opening the door while `running` → **robot emergency stop** (EMERGENCY rung); lamp blinks 2 Hz while open and is exempt from the safe state | `door_closed`, `running` (default `S.ARMED`), **`lamp`**?, **`closed_ok`**? |
| `blinker` | output blinks while `enable`, starting with ON | `enable`, **`output`**, `on_time` 500ms, `off_time` 500ms |

`?` = optional. Defaults are shown after the time ports.

Example cell built from blocks: `programs/cell_with_blocks.yaml` (clamp cylinder, door guard, BT
handshake, part counter, lamp tower + three rungs of cell logic) with its scenario
`programs/cell_with_blocks.sim`.

## J.3 Writing your own block

A block file is a small program with **port names instead of addresses**:

```yaml
# blocks/valve_with_feedback.yaml
block: valve_with_feedback
description: "Valve output with feedback sensor and fault"
ports:
  command:  {kind: in}                    # what the block reads
  feedback: {kind: in}
  valve:    {kind: out}                   # what the block writes (one owner)
  fault:    {kind: out}
  reset:    {kind: in, optional: true}    # may be left open (reads 0)
  fb_time:  {kind: time, default: 1s}     # may be left open (takes the default)
locals:
  pending: M                              # internal bits / registers, allocated per instance
safe_state:
  exempt: [valve]                         # optional: ports that keep following the rungs in an emergency
retain: [ ]                               # optional: register ports / locals kept over a restart
rungs:
  - {out: valve,   when: "command AND NOT fault"}
  - {out: pending, when: "valve AND NOT feedback"}
  - {set: fault,   when: "ON_FOR(pending, fb_time)"}
  - {reset: fault, when: "RISE(reset)"}
alarms:
  - {bit: fault, text: "Valve feedback missing", level: error, toast: true}
sequences: [ ]                            # allowed too; names get the instance prefix
```

Rules for the file:

* Sections: `block`, `description`, `ports`, `locals`, `retain`, `safe_state`, `rungs`,
  `sequences`, `alarms`. Nothing else.
* Port and local names: letters, digits, `_`; not a keyword of the expression language (`and`,
  `not`, `rise` …). The YAML keys of the rungs (`out`, `when`, `reset` …) are never replaced, so a
  port may be called `reset`.
* A `default:` may be a value (`2s`, `10`, `S.ARMED`, `TRUE`) or the name of **another port**
  (`running_fb: {kind: in, default: run_cmd}` = "if no feedback is connected, use the command").
* `text:` and `name:` values are plain text (port names inside them are not replaced).
* Keep blocks small and single-purpose; the program combines them. Avoid raw addresses inside a
  block – everything it touches should be a port, otherwise two instances would fight for the bit.

Test it before you use it: put a program with one instance and a scenario next to it
(`blocks/tests/<name>.yaml` + `.sim` is the pattern) and run
`ros2 run nextplc nextplc_sim my_test.yaml my_test.sim` (Part K). Your own blocks go to
`/home/nextup/user_config_files/plc/blocks/` (or `blocks/` next to the program) and are found like
the library ones.

---

# Part K – The simulator

`nextplc_sim` runs a program in the real engine against a **scenario** – a short script of inputs and
expectations – on any Linux PC, without ROS and without the robot. It prints every change as a
timing table and says PASS or FAIL. Use it to test a program before commissioning, to reproduce a
problem from the field, and as the test of every library block.

```bash
ros2 run nextplc nextplc_sim program.yaml scenario.sim
ros2 run nextplc nextplc_sim program.yaml scenario.sim --csv trace.csv --quiet
```

Exit code 0 = every `EXPECT` passed, 1 = a check failed, 2 = a file or scenario error.
Blocks are found like for the node (`--blocks DIR`, `$NEXTPLC_BLOCK_DIRS`, the user folder, the
installed library).

## K.1 A scenario, line by line

```
# scenario for cell_with_blocks.yaml
SUPERVISOR AUTO                               # robot profile AUTO, status fresh
SUPERVISOR ARMED 1
WATCH M10 M11 R0 clamp.in_position            # also print these when they change
LINK gpio1.do1 -> gpio1.di2 AFTER 400ms       # the clamp's "closed" sensor follows the valve after 400 ms
LINK gpio1.do1 -> gpio1.di3 AFTER 400ms INVERT   # the "open" sensor is the opposite
SET gpio1.di5 1                               # door closed
WAIT 50ms
EXPECT gpio1.do6 1                            # green lamp
SET gpio1.di1 1                               # a part arrives
EXPECT gpio1.do1 1 WITHIN 400ms               # the valve comes after the 300 ms debounce
EXPECT M11 1 WITHIN 500ms                     # the robot is asked once the clamp is closed
WAIT 1s
PULSE M13 100ms                               # the BT answers (PulseBit M13)
EXPECT M11 0 WITHIN 20ms
EXPECT R0 1                                   # one part counted
SET gpio1.di5 0                               # the door is opened
EXPECT EMERGENCY WITHIN 20ms
EXPECT S.SAFE_STATE 1
```

Output (shortened):
```
     10 ms  SUPERVISOR AUTO
     60 ms  OK    EXPECT gpio1.do6 1
     60 ms  SET part_present = 1
    360 ms  gpio1.do1 = 1
    360 ms  OK    EXPECT gpio1.do1 1 WITHIN 400ms   (at 360 ms)
    760 ms  gpio1.di2 = 1   (LINK gpio1.do1 after 400ms)
    760 ms  M11 = 1
    760 ms  OK    EXPECT M11 1 WITHIN 500ms   (at 760 ms)
   ...
   3490 ms  EMERGENCY REQUEST: Guard door opened while the robot was running  [rung 10 (emergency, line 17)]
   3490 ms  S.SAFE_STATE = 1
   3490 ms  OK    EXPECT EMERGENCY WITHIN 20ms   (at 3490 ms)
   3510 ms  supervisor: emergency latched (S.EMERGENCY = 1)
RESULT: PASS (15 checks, 4.01 s simulated, 401 scans)
```

The simulator found a real mistake while this example was written: the first version asked the
robot (`M20`) from `clamp.in_position`, which is computed by the block *after* the program's own
rungs – so in the scan the clamp was requested, the old "in position" (open) was still 1 and
the robot was asked before the clamp had closed. The log showed `M11 = 1` in the same scan as the
valve; the fix is to use the closed sensor itself (`{out: M20, when: "M10 AND gpio1.di2"}`). That is what
the tool is for.

## K.2 Statements

| Statement | Meaning |
|---|---|
| `SCAN 10ms` | scan time (default 10 ms) |
| `WATCH a b c` | print these when they change. Default: every physical output, `S.SAFE_STATE`, `S.PLC_EMERGENCY`, the sequence steps. `WATCH ALL` adds every M and R |
| `SUPERVISOR AUTO` / `SAFEAUTO` / `JOG` | the profile bits; status fresh |
| `SUPERVISOR OFF` | no supervisor: `S.SUPERVISOR_OK` 0, emergency assumed (like the node) |
| `SUPERVISOR ARMED 1`, `EMERGENCY 1`, `ESTOP 1`, `STANDSTILL 1`, `FAULT 1` | one status bit (0 clears it) |
| `SUPERVISOR RESET` | `reset_fault`: emergency, e-stop and fault bits back to 0 |
| `SUPERVISOR MANUAL` / `MODEL` | switch the emergency model off / on (see 3) |
| `INPUTS STALE` / `INPUTS OK` | the DI topics stop / come back: outputs held in the safe state, like the node |
| `SET gpio1.di1 1` | an input. `SET M10 1`, `SET R0 5` = a write from the BT / web (`set_bits`, same rules: refused for a bit a rung drives). Outputs cannot be SET – they are the program's result |
| `PULSE gpio1.di7 100ms` | input 1 for 100 ms. `PULSE M13 100ms` = `PulseBit` |
| `LINK gpio1.do1 -> gpio1.di2 AFTER 300ms [INVERT]` | a model: the input follows the output after the delay (cylinder end sensor, contactor auxiliary contact, valve feedback). `INVERT` = the opposite sensor. The input starts consistent with the output |
| `UNLINK gpio1.di2` | the sensor no longer follows – a broken sensor, a stuck cylinder |
| `TOGGLE gpio1.di6 EVERY 200ms` | a pulsing input: parts passing a sensor, an encoder. `STOP TOGGLE gpio1.di6` |
| `AT 1500ms` | run until this absolute time |
| `WAIT 500ms`, `RUN 2s` | run this long |
| `PRINT "text"` | a line in the log |
| `EXPECT x 1` | check now |
| `EXPECT x 1 WITHIN 2s` | run until true; the time it became true is reported; FAIL after 2 s |
| `EXPECT x STAYS 1 FOR 2s` | run 2 s; FAIL if it ever differs |
| `EXPECT ALARM M30 [WITHIN 2s]` | an alarm on that bit was raised (since the last EXPECT, or within the window) |
| `EXPECT NO ALARM M30 FOR 2s` | none for 2 s |
| `EXPECT EMERGENCY [WITHIN 2s]` / `EXPECT NO EMERGENCY FOR 2s` | an `emergency:` rung fired / did not |

Names are anything the program knows: raw addresses, aliases, `clamp.busy`, `seq.pick.step`,
`S.AUTO`. Values: `1 0 ON OFF TRUE FALSE` or a number. Times need a unit. `#` starts a comment.

## K.3 What the simulator does for you

* **It is the real engine.** Rungs, timers, counters, sequences, safe state, emergency – nothing is
  mocked. Only the ROS node is missing: inputs come from the scenario instead of the topics.
* **The program is running when the scenario starts**: one scan is done first (the clock reads
  10 ms at the first statement), so edges are armed exactly as on the robot.
* **A SET is seen in the next scan**: `SET gpio1.di1 1` followed by `EXPECT gpio1.do1 1` runs that
  scan before checking – like the real PLC, the reaction is one scan later. Timers add their time
  on top; use `WITHIN` for anything that is not immediate.
* **Supervisor model**: the real supervisor latches the emergency that an `emergency:` rung
  requests. The simulator does the same 20 ms after the request (`S.EMERGENCY` = 1, `S.PLC_EMERGENCY`
  back to 0), until `SUPERVISOR RESET`. `SUPERVISOR MANUAL` turns this off when you want to test the
  PLC latch alone.
* **The log** shows writes (`SET`, `PULSE`), model events (`LINK … after …`), every change of a
  watched signal, emergency requests, alarms, and each check with `OK` / `FAIL` and the time.
* **`--csv trace.csv`**: one row per scan with every watched signal – open it in a spreadsheet to
  draw the timing diagram.

## K.4 Patterns

**Commissioning test of a cell**: write the scenario from the specification ("part arrives →
clamp closes within 500 ms → robot asked"), run it on the office PC, then on the robot replace the
`LINK`s by the real sensors. Keep the scenario in the project: it is the acceptance test.

**Reproduce a field problem**: take the sequence of inputs from the log (`/nextplc/state` or the
alarm history), write them as `AT … SET …` lines, and watch the rung results.

**Test a block** (what `blocks/tests/*.sim` do): one instance with raw addresses, `LINK` the
feedback, exercise the normal path, then `UNLINK` to provoke the fault, `PULSE` the reset.

**Timing check of a program**: `WATCH` the output, `SET` the input, let `EXPECT … WITHIN`
report the real reaction time (`at 380 ms`), compare with the specification.

## K.5 Limits

* Only digital I/O and the supervisor bits are modelled; no motion, no MoveIt. The BT is replaced
  by `SET` / `PULSE` on the M bits it would write.
* Time is simulated (a scan per statement step), so a 10 s scenario runs in milliseconds – it is
  not a real-time test of the controller PC.
* `LINK` is a pure delay; a sensor that bounces or a cylinder that is slower under load is written
  as a second `LINK` / a `TOGGLE` in the scenario.

---

# Part L – The behaviour tree and the PLC

## L.1 The rule

The BT only writes `M` bits and `R` registers. It **never** writes a `Q`. Every physical output passes
through a rung, so every interlock stays in force even if the BT is wrong, stopped, or in dry run.

## L.2 The nodes (package `control_logic_bt`, folder `nextplc`)

| Node | Ports | Behaviour |
|---|---|---|
| `SetBit` | `address`, `value` (0/1, default 1), `timeout_ms` (500) | publishes `/nextplc/set_bits`; SUCCESS when a newer `/nextplc/state` shows the value; FAILURE after `timeout_ms` (PLC not running, unknown address, or the bit is driven by a rung). `timeout_ms="0"` = fire and forget, SUCCESS at once |
| `PulseBit` | `address`, `ms` (100), `timeout_ms` (0) | bit = 1 for `ms`, then the PLC resets it. SUCCESS at once; with `timeout_ms > 0` waits until the state shows 1 |
| `WaitBit` | `address`, `value` (1), `timeout_ms` (0 = no limit), `max_age_ms` (500) | RUNNING until the bit/register equals `value` in a state younger than `max_age_ms`; FAILURE on timeout |
| `CheckBit` | `address`, `value` (1), `max_age_ms` (500) | condition: one look at the latest fresh state |
| `SetRegister` | `address`, `value` (int, also `{blackboard}`), `timeout_ms` (500) | like `SetBit` for a register |
| `GetRegister` | `address`, `value` (output port) | reads a register (or a bit as 0/1) into the blackboard; FAILURE without state |

The port is called `address` because BehaviorTree.CPP reserves the word `name`. It takes a raw address
or an alias of the loaded program.

Dry run (runner `start {dry_run: true}`): `SetBit`/`PulseBit`/`SetRegister` publish nothing and
succeed; `WaitBit`/`CheckBit` succeed after the sim delay. Sim mode: the same for the waits.

All four write/wait actions are soft-stop aware (registered through `registerWithNode`, like the
other I/O nodes): a stop or pause of the runner holds the next one.

## L.3 The handshake, step by step

Rungs:
```yaml
- {out: gpio1.do1, when: "M10 AND gpio1.di1"}         # A
- {out: M11,       when: "gpio1.do1 AND gpio1.di2"}   # B
- {out: M12,       when: "NOT gpio1.di2"}             # C
```
Tree:
```xml
<Sequence>
  <MoveTo pose="P1" planner="PTP" speed="0.25"/>
  <SetBit  address="M10" value="1"/>
  <WaitBit address="M11" value="1" timeout_ms="5000"/>
  <MoveTo pose="P2" planner="PTP" speed="0.25"/>
  <SetBit  address="M10" value="0"/>
  <WaitBit address="M12" value="1" timeout_ms="5000"/>
</Sequence>
```
1. Robot at P1. `SetBit` publishes `{name: [M10], value: [1]}`; within one scan `M10` = 1.
2. Rung A: `M10` 1 **and** sensor `gpio1.di1` 1 → `gpio1.do1` = 1, sent to the GPIO controller
   (~15–25 ms after the BT). No part → nothing happens: the interlock is in the PLC.
3. Rung B: `gpio1.do1` 1 and feedback `gpio1.di2` 1 → `M11` = 1.
4. `WaitBit M11` succeeds, the tree continues. Feedback never comes → FAILURE after 5 s → error branch.
5. `SetBit M10 = 0` → rung A: `gpio1.do1` = 0; rung B: `M11` = 0.
6. Rung C: `gpio1.di2` drops → `M12` = 1 → the tree continues.

## L.4 Patterns

**Request / done with a counter**
```yaml
- {out: gpio1.do3, when: "M15 AND S.AUTO"}                       # BT sets M15 = "please clamp"
- {out: M16,       when: "gpio1.do3 AND ON_FOR(gpio1.di3, 200ms)"} # clamp closed, debounced -> BT waits on M16
- {count: R0, up: "RISE(M17)", reset: "RISE(gpio1.di7)", preset: R2, done: M18}   # BT pulses M17 per part
```
Tree: `SetBit M15=1` → `WaitBit M16=1 timeout 3000` → motion → `PulseBit M17 100` → `SetBit M15=0` →
`CheckBit M18=1` decides "batch finished".

**Interlock the BT cannot bypass**
```yaml
- {out: joint6.do1, when: "M20 AND gpio1.di5 AND NOT gpio1.di6 AND S.AUTO"}   # weld only with door closed (di5) and no gas alarm (di6)
```
The BT only sets `M20`. If the door opens during the weld the PLC switches `joint6.do1` off within one
scan – without any BT tick.

**Fault to the BT**
```yaml
- {set:   M30, when: "ON_FOR(gpio1.do3 AND NOT gpio1.di3, 2s)"}
- {reset: M30, when: "RISE(gpio1.di8) OR RISE(M31)"}              # reset button or BT (SetBit M31 pulse)
alarms:
  - {bit: M30, text: "Clamp feedback missing", level: error}
```
Tree: a `ReactiveSequence` with `CheckBit address="M30" value="0"` on top stops the job when the alarm
latches; the recovery branch uses `PulseBit M31`.

---

# Part M – Topics, services, messages, parameters

Node name: `nextplc`. Everything below is created by `nextplc_node`.

## M.1 Topics the PLC subscribes to (your existing topics)

| Topic | Type | Used for |
|---|---|---|
| `/nextup_digital_inputs` | `nextup_joint_interfaces/NextupDigitalInputs` | `jointN.di1..di8` (by `name` = `jointN`; order fallback) |
| `/nextup_gpio_command_controller/gpio_states` | `control_msgs/DynamicInterfaceGroupValues` | `gpio1.di1..di8` (group `gpio1`, names `di1..di8`; NaN = keep last) |
| `/nextup_motion_supervisor/status` | `nextup_joint_interfaces/NextupSupervisorStatus` | `S.AUTO S.SAFEAUTO S.JOG S.ARMED S.EMERGENCY S.ESTOP S.STANDSTILL S.ANY_FAULT` |
| `/nextup_digital_output_controller/applied_commands` | `nextup_joint_interfaces/NextupDigitalOutputsCommand` | confirmation of drive outputs; detection of outside changes |
| `/nextup_gpio_command_controller/applied_commands` | `control_msgs/DynamicInterfaceGroupValues` | confirmation of gpio1 outputs |
| `/nextplc/set_bits` | `nextplc/SetBits` | writes from the BT and the web (see M.4) |

Topic names are parameters (`di_topic`, `gpio_states_topic`, `supervisor_status_topic`,
`do_applied_topic`, `gpio_applied_topic`).

## M.2 Topics the PLC publishes

| Topic | Type | Rate / QoS | Content |
|---|---|---|---|
| `/nextup_digital_output_controller/commands` | `NextupDigitalOutputsCommand` | on change; reliable 10 | changed drive outputs: `name: [joint6], do2: [1], do1: [-1] …` (−1 = unchanged) |
| `/nextup_gpio_command_controller/commands` | `DynamicInterfaceGroupValues` | on change | changed gpio1 outputs: `{interface_groups: [gpio1], interface_values: [{interface_names: [do1], values: [1.0]}]}` |
| `/nextplc/state` | `nextplc/PlcState` | 50 Hz (`state_rate_hz`); reliable, depth 1; only while someone listens | the whole image table (M.3) |
| `/nextplc/alarms` | `nextplc/Alarm` | one per alarm edge; reliable 100 | `bit text level active` |
| `/nextplc/program` | `nextplc/ProgramInfo` | latched (transient local) | the loaded program text, or the refused text + error |
| `/bt_toast_popup` | `std_msgs/String` | on alarm / IO fault | `<text>,failure,10` or `<text>,success,10` (parameter `toast_topic`, `""` = off) |

## M.3 Message `nextplc/PlcState`

```
std_msgs/Header header
string   program            # name of the loaded program ("" = none)
bool     program_ok
bool     safe_state         # controlled outputs held in their safe state
uint32   scan_count
float32  scan_time_ms       # duration of the last scan
float32  scan_period_ms     # time between the last two scans (~10)
uint32   forced_count
string[] bit_names          # 56 I, 32 Q, 128 M, 17 S  (canonical names, in this order)
uint8[]  bit_values         # 0/1, parallel to bit_names; Q = PHYSICAL value
bool[]   bit_forced         # parallel to bit_names
uint8[]  logic_q            # what the rungs want for each Q (32, same order as the Q entries)
bool[]   q_controlled       # which Q the PLC sends (32)
string[] reg_names          # R0..R31
int32[]  reg_values
string[] alias_names        # io:/names: of the program
string[] alias_targets      # canonical name of each alias
string[] seq_names
int32[]  seq_steps          # 0 = idle
string[] seq_step_names     # active step name ("" when idle)
string[] rung_texts         # one line per rung, file order
bool[]   rung_results       # result of each rung's condition in the last scan
```
Index of an entry in `bit_names`: I = 0..55 (`joint1.di1`…`joint6.di8`, `gpio1.di1`…`di8`), Q = 56..87
(`joint1.do1 do2 do3 pi_p` … `joint6.…`, `gpio1.do1`…`do8`), M = 88..215, S = 216..232.

Other messages:
```
nextplc/SetBits        string[] name   int32[] value   uint32[] pulse_ms   (pulse_ms empty or one per name)
nextplc/Alarm          Header header   string bit   string text   string level   bool active
nextplc/ProgramInfo    Header header   bool ok   string name   string path   string error
                       string text         # the YAML as loaded / refused
                       uint32 rung_count   uint32 sequence_count   bool has_emergency
                       string[] blocks     # "clamp = cylinder" per library block
```

## M.4 Services

| Service | Type | Request → Response |
|---|---|---|
| `/nextplc/set_bits` | `nextplc/srv/SetBits` | `name[] value[] pulse_ms[]` → `ok message` |
| `/nextplc/get_bits` | `nextplc/srv/GetBits` | `name[]` (empty = everything) → `ok message name[] value[]` |
| `/nextplc/load_program` | `nextplc/srv/LoadProgram` | `path` (`""` = reload the current file) → `ok message` |
| `/nextplc/force_bit` | `nextplc/srv/ForceBit` | `name value release` → `ok message` |

**set_bits rules** (topic and service): only `M` and `R`. Refused: `I` (physical input), `S` (system),
`Q` (*only a rung may write it*), an `M` bit driven by an `out:`/`toggle:` rung or a sequence (*M11 is
driven by rung 3 (out, line 5), a write from outside would be overwritten in the next scan*), a bit
value other than 0/1, an unknown name. All names are checked first; if one is unknown nothing is
written. `pulse_ms` > 0 on a bit: back to 0 after that time (a new write cancels the pulse). A
register may always be written, also a counter register. The topic logs a refusal (throttled 2 s);
the service answers it.

**get_bits**: `Q` entries return the **physical** value. Empty `name` = all bits and registers.

**load_program**: the file is checked completely; any error → `ok: false`, `message: "line N: …"`,
the running program is unchanged. Success → `"loaded <name>: N rungs, N sequences, N alarms; controls
N of 32 outputs, the others stay free (<path>)"`. The path becomes the new `program_file`.

**force_bit**: only physical `I` and `Q`. A forced input drives the logic instead of the real one; a
forced output wins over the rungs and over the safe state. Refused in AUTO unless
`allow_force_in_auto`. `release: true` removes the force. Forced bits are flagged in `/nextplc/state`
(`bit_forced`, `forced_count`). Forces are not saved; a node restart clears them.

Examples:
```bash
ros2 topic pub --once /nextplc/set_bits nextplc/msg/SetBits "{name: [M10], value: [1]}"
ros2 topic pub --once /nextplc/set_bits nextplc/msg/SetBits "{name: [M12], value: [1], pulse_ms: [100]}"
ros2 service call /nextplc/set_bits nextplc/srv/SetBits "{name: [M10, R0], value: [0, 5]}"
ros2 service call /nextplc/get_bits nextplc/srv/GetBits "{name: [gpio1.di1, gpio1.do1, M10, R0, S.AUTO]}"
ros2 service call /nextplc/get_bits nextplc/srv/GetBits "{}"                          # everything
ros2 service call /nextplc/load_program nextplc/srv/LoadProgram "{path: ''}"           # reload
ros2 service call /nextplc/load_program nextplc/srv/LoadProgram "{path: /home/nextup/user_config_files/plc/cell2.yaml}"
ros2 service call /nextplc/force_bit nextplc/srv/ForceBit "{name: gpio1.di1, value: true}"
ros2 service call /nextplc/force_bit nextplc/srv/ForceBit "{name: gpio1.di1, release: true}"
ros2 topic echo /nextplc/state --once
ros2 topic echo /nextplc/alarms
ros2 topic echo /nextplc/program --once          # the loaded text / the load error
ros2 run nextplc nextplc_check /path/program.yaml
ros2 run nextplc nextplc_sim /path/program.yaml /path/scenario.sim   # simulate without the robot
ros2 service call /nextup_motion_supervisor/reset_fault std_srvs/srv/Trigger   # after an EMERGENCY rung fired
```

## M.5 Node parameters (`config/nextplc.yaml`)

| Parameter | Default | Meaning |
|---|---|---|
| `program_file` | `/home/nextup/user_config_files/plc/program.yaml` | the program |
| `retain_file` | `/home/nextup/user_config_files/plc/retain.yaml` | retained registers |
| `scan_ms` | 10.0 | scan cycle (a program's `scan_ms:` overrides it) |
| `state_rate_hz` | 50.0 | `/nextplc/state` rate |
| `di_timeout_ms` | 500 | both input topics must be younger than this → `S.DI_OK` |
| `hold_on_stale_inputs` | true | stale inputs → controlled outputs to safe state |
| `supervisor_timeout_ms` | 1000 | supervisor status freshness → `S.SUPERVISOR_OK` |
| `require_supervisor` | true | no fresh status → `S.EMERGENCY` = 1 (safe state). `false` for bench tests |
| `apply_timeout_ms` | 100 | a sent output must be echoed on `applied_commands` within this time, else sent once more; still nothing → `S.IO_FAULT`, toast, retry every second |
| `startup_grace_ms` | 20000 | no IO-fault report in the first 20 s (controllers may start later) |
| `write_all_on_load` | true | after a load every controlled output is written once |
| `reassert_outputs` | true | an outside change of a controlled output is undone (program wins) |
| `control_unused_outputs` | **false** | `false`: only outputs in the program are touched; `true`: the PLC owns all 32 |
| `allow_force_in_auto` | false | `force_bit` in AUTO |
| `toast_topic` | `/bt_toast_popup` | web-UI toasts (`""` = off) |
| `emergency_service` | `/nextup_motion_supervisor/trigger_emergency` | `std_srvs/Trigger` called when an `emergency:` rung fires (E.10); `""` = safe state only, no call |
| `emergency_retry_ms` | 1000 | repeat the call while it fails / the service is away |
| `block_dirs` | `[/home/nextup/user_config_files/plc/blocks]` | where `use:` blocks are looked up, after `<program dir>/blocks` and before the installed library |
| `di_topic` … `gpio_applied_topic` | the Nextup names | the seven controller topics |

## M.6 Log lines you will see

| Line | Meaning |
|---|---|
| `loaded first_test: 5 rungs, 0 sequences, 0 alarms; controls 4 of 32 outputs, the others stay free (…)` | program running (`, 5 blocks` when library blocks are used) |
| `No program running: program '…' refused: line 7: …` | fix the file, then `load_program` |
| `Scan cycle 10.0 ms` | timer started |
| `Outputs held in safe state: no fresh /nextup_digital_inputs …` / `Inputs and supervisor fresh again` | input freshness |
| `set_bits refused: …` | a write from the BT/web was refused (reason follows) |
| `IO fault: gpio1.do1 not applied by its controller …` / `IO fault cleared` | the controller did not echo a command |
| `ALARM M30: …` | an alarm bit went 1 |
| `gpio1.di1 forced to 1 (1 forced)` | a force is active |
| `EMERGENCY from the program: <text> (rung N (emergency, line L)) -> /nextup_motion_supervisor/trigger_emergency, outputs to safe state` | an `emergency:` rung fired |
| `supervisor emergency triggered by the PLC program: …` / `emergency service … not available, retrying in 1000 ms` | the service call result |
| `PLC emergency latch released (supervisor has latched the emergency)` | hand-over to the supervisor |

---

# Part N – Rules at a glance

1. Rungs run in file order every scan. A bit written by rung 3 has its new value for rung 7 in the
   same scan. Sequences run after the rungs.
2. `out:` writes every scan (1 and 0). `set:`/`reset:` write only while their condition is 1; both at
   once → the lower rung wins.
3. One owner per bit: one `out:`/`toggle:` rung, or one sequence, or one counter `done:`. `set:`/
   `reset:`/`on_timeout` may share a bit among themselves. The file is refused otherwise.
4. One `count:` rung per register; `move:`/`calc:` may not write a counter register; several
   `move:`/`calc:` may write the same register.
5. `RISE`/`FALL` last one scan and must have seen the 0 first (no edge at load / step entry).
6. Timers count real time; `ton:`/`tof:`/`tp:` only on `out:`, one per rung; times need a unit, or
   are a register / alias holding milliseconds (read every scan).
7. Only `M` and `R` can be written from outside. `I` and `S` are read only. `Q` only through rungs.
   An `M` with an `out:` rung cannot be written from outside.
8. Only outputs written in the program are controlled (sent at load, on change, re-asserted, safe
   state). All other DO stay free.
9. A controlled output is sent only when it changes; no echo within 100 ms → sent again; still none →
   `S.IO_FAULT` + toast + retry every second (silent in the first 20 s after start).
10. Emergency / no program / stale inputs / node stop → controlled outputs to their safe value
    (`exempt` ones excepted); rungs keep running; sequences go idle.
11. Reload keeps `M` and `R` (M bits owned by the old program are cleared), restarts timers, edges
    and sequences, writes every controlled output once. A faulty file never replaces a running one.
12. The hardware e-stop / STO chain stays in hardware. The PLC is cell logic, not safety.
13. An `emergency:` rung fires on the rising edge of its condition: safe state at once
    (`S.PLC_EMERGENCY`), the supervisor's `trigger_emergency` service is called (retried every second
    while it fails), the latch is handed over when the supervisor reports the emergency and cleared
    by a program reload.
14. A library block is expanded into rungs at load: its `out` ports are owned by it, its locals get
    free bits from the top (`clamp.busy`), an error names block, instance and program line. Test a
    program or a block in the simulator before it goes on the robot.

---

# Part O – Worked examples

Each is a complete program file. Check with `nextplc_check`, load with `load_program`.

## O.1 Conveyor stop and go (coil + debounce)

Part sensor `gpio1.di1`, conveyor motor `gpio1.do1`, run enable from the BT in `M10`.

```yaml
program: conveyor
rungs:
  - {out: gpio1.do1, when: "M10 AND NOT ON_FOR(gpio1.di1, 300ms) AND S.AUTO"}
```
The motor runs while the BT allows (`M10`), the robot is in AUTO, and no part has been in front of
the sensor for 300 ms (a passing part does not stop it, a waiting part does).

## O.2 Gripper with feedback and fault (set/reset, ON_FOR, alarm)

Gripper valve `joint6.do2`, closed sensor `joint6.di1`, open sensor `joint6.di2`, request from the
BT `M20`, reset button `gpio1.di8`.

```yaml
program: gripper
rungs:
  - {out: joint6.do2, when: "M20 AND NOT M30"}                              # close while requested and no fault
  - {out: M21, when: "joint6.do2 AND ON_FOR(joint6.di1, 100ms)"}           # "closed" to the BT
  - {out: M22, when: "NOT joint6.do2 AND ON_FOR(joint6.di2, 100ms)"}       # "open" to the BT
  - {set:   M30, when: "ON_FOR(joint6.do2 AND NOT joint6.di1, 1500ms)"}    # commanded 1.5 s, not closed
  - {set:   M30, when: "ON_FOR(NOT joint6.do2 AND NOT joint6.di2, 1500ms)"}# released 1.5 s, not open
  - {reset: M30, when: "RISE(gpio1.di8)"}
alarms:
  - {bit: M30, text: "Gripper did not reach its position", level: error, toast: true}
```
BT: `SetBit M20=1` → `WaitBit M21=1 timeout 2000` → move → `SetBit M20=0` → `WaitBit M22=1 timeout 2000`.

## O.3 Lamp tower (system bits, blink, exempt)

```yaml
program: lamps
safe_state:
  exempt: [gpio1.do5, gpio1.do6, gpio1.do7]      # lamps keep working in an emergency
rungs:
  - {out: gpio1.do5, when: "S.AUTO AND NOT S.EMERGENCY AND NOT M30"}                 # green: production
  - {out: gpio1.do6, when: "(S.JOG OR S.SAFEAUTO) AND NOT S.EMERGENCY"}              # yellow: manual
  - {out: gpio1.do7, when: "S.EMERGENCY AND S.BLINK_1HZ OR M30 AND NOT S.EMERGENCY"} # red: blink on emergency, steady on fault
  - {out: gpio1.do8, when: "RISE(S.EMERGENCY)", tp: 2s}                              # horn 2 s when an emergency latches
```
(`gpio1.do8` is not exempt, so it is only heard when the emergency is **not** yet active – add it to
`exempt` if the horn must sound during the emergency.)

## O.4 Batch counter with retained count (count, move, retain)

Part done pulse from the BT `M13`, batch size in `R2` (set by the web UI), reset button `gpio1.di7`.

```yaml
program: batch
retain: [R0, R2]
rungs:
  - {move: R2, value: 10, when: "S.FIRST_SCAN AND R2 == 0"}           # first start ever: 10 parts
  - {count: R0, up: "RISE(M13)", reset: "RISE(gpio1.di7)", preset: R2, done: M24}
  - {calc: "R3 = R2 - R0"}                                             # parts to go, for the UI
  - {out: gpio1.do4, when: "M24", tp: 1s}                              # 1 s "batch done" signal
alarms:
  - {bit: M24, text: "Batch finished", level: info, toast: true}
```
`R0` and `R2` survive a restart. The BT reads `R3` with `GetRegister` if it wants to show progress.

## O.5 Two-hand start (edges, timing between two inputs)

Both buttons `gpio1.di1` and `gpio1.di2` must be pressed within 500 ms of each other.

```yaml
program: two_hand
rungs:
  - {out: M40, when: "gpio1.di1 AND gpio1.di2"}
  - {out: M41, when: "ON_FOR(gpio1.di1 AND NOT gpio1.di2, 500ms) OR ON_FOR(gpio1.di2 AND NOT gpio1.di1, 500ms)"}
  - {set:   M42, when: "M41"}                     # one hand too early: locked
  - {reset: M42, when: "NOT gpio1.di1 AND NOT gpio1.di2"}   # release both to try again
  - {out: M43, when: "RISE(M40) AND NOT M42"}     # the valid start pulse for the BT (WaitBit M43)
```

## O.6 Pick cycle as a sequence (the full pattern)

Part sensor `gpio1.di1`, clamp `gpio1.do1` with closed sensor `gpio1.di2`, robot handshake `M11`
(PLC→BT: pick now) / `M13` (BT→PLC: pick done), start button `gpio1.di7`.

```yaml
program: pick_cycle
sequences:
  - name: pick
    start: "S.AUTO AND RISE(gpio1.di7)"
    abort: "S.EMERGENCY OR NOT S.AUTO OR M30"
    steps:
      - {name: wait_part, do: [],              next: "ON_FOR(gpio1.di1, 300ms)"}
      - {name: clamp,     do: [gpio1.do1],     next: "gpio1.di2",       timeout: 2s, on_timeout: M30}
      - {name: robot,     do: [gpio1.do1, M11], next: "M13"}
      - {name: release,   do: [],              next: "NOT gpio1.di2",   timeout: 2s, on_timeout: M30}
      - {name: done,      do: [M14],           next: "TRUE"}
rungs:
  - {reset: M30, when: "RISE(gpio1.di8)"}
  - {count: R0, up: "seq.pick.done"}                       # one per finished cycle
  - {out: gpio1.do5, when: "seq.pick.active"}              # lamp: cycle running
alarms:
  - {bit: M30, text: "Clamp did not close / open in 2 s", level: error, toast: true}
```
Tree: `WaitBit M11=1 timeout 0` (wait for the PLC) → `MoveTo` … → `PulseBit M13 100` → back to the
wait. The tree does only motion; the PLC decides when.

## O.7 Blink cycle with an idle output (sequence, hold step) – `programs/blink_cycle.yaml`

`joint1.do1` is 1 at rest. `joint1.di1` 0→1: `joint1.do3` on 2 s, off 3 s, on 2 s, off 2 s, then
stays on; `joint1.do1` is 0 the whole time. `joint1.di1` back to 0 → `do3` off, `do1` on again.

```yaml
sequences:
  - name: cycle
    start: "RISE(joint1.di1)"            # once per 0 -> 1 of joint1.di1
    abort: "NOT joint1.di1"              # joint1.di1 = 0 at any time -> back to rest
    steps:
      - {name: on1,  do: [joint1.do3], next: "ON_FOR(TRUE, 2s)"}
      - {name: off1, do: [],           next: "ON_FOR(TRUE, 3s)"}
      - {name: on2,  do: [joint1.do3], next: "ON_FOR(TRUE, 2s)"}
      - {name: off2, do: [],           next: "ON_FOR(TRUE, 2s)"}
      - {name: hold, do: [joint1.do3], next: "NOT joint1.di1"}
rungs:
  - {out: joint1.do1, when: "NOT seq.cycle.active"}   # 1 whenever the cycle is not running
```
Line by line: `start` – the scan joint1.di1 goes 0→1, step `on1` begins and joint1.do3 = 1.
`next: ON_FOR(TRUE, 2s)` – the step lasts 2 s. `off1` has nothing in `do`, so joint1.do3 = 0 for 3 s.
… `hold` keeps joint1.do3 = 1 until joint1.di1 = 0. `abort` – joint1.di1 = 0 ends the cycle in any
step. The rung makes joint1.do1 = 1 exactly when `seq.cycle.active` is 0.

## O.8 Blink N times with a configurable time – second half of `programs/blink_cycle.yaml`

Each 0→1 of `joint1.di2`: joint1.do2 blinks 10 times, `blink_time` on / `blink_time` off.
`blink_time` is register R10 (milliseconds), so it can be changed without touching the file:
`set_bits blink_time 200` (web, BT `SetRegister`, or the service).

```yaml
names: {blink_time: R10}
retain: [blink_time]
rungs:
  - {move: blink_time, value: 500, when: "S.FIRST_SCAN AND blink_time == 0"}   # default 500 ms
  - {set: M20,   when: "RISE(joint1.di2)"}                                     # start blinking
  - {count: R11, up: "FALL(joint1.do2)", reset: "NOT M20"}                     # count finished blinks
  - {reset: M20, when: "R11 >= 10"}                                            # stop after 10
  - {out: M21, when: "M20 AND NOT M22", ton: blink_time}                       # on time over
  - {out: M22, when: "M21", ton: blink_time}                                   # off time over
  - {out: joint1.do2, when: "M20 AND NOT M21"}
```
Line by line: the first scan writes 500 into R10 if it is still 0 (a retained, changed value is
kept). A 0→1 of joint1.di2 sets M20. While M20 = 1: joint1.do2 is 1 until M21 comes after
`blink_time`; M21 makes joint1.do2 0; M22 comes after another `blink_time` and resets M21 (because
`M21` needs `NOT M22`), so the cycle repeats. Each 1→0 of joint1.do2 adds 1 to R11; at 10, M20 is
reset, R11 goes back to 0 and joint1.do2 stays 0 until the next 0→1 of joint1.di2.
For "blink while a condition is true" (no count) use the `blinker` block.

## O.9 Door interlock with robot emergency stop (emergency rung)

Door switch `gpio1.di5` (1 = closed). While the robot runs in AUTO the door must stay closed; in JOG
the operator may open it (the drives are already limited by the supervisor).

```yaml
rungs:
  - {emergency: "NOT gpio1.di5 AND S.AUTO AND S.ARMED", text: "Door opened while running in AUTO"}
  - {out: gpio1.do6, when: "gpio1.di5"}                       # green: door closed
  - {out: gpio1.do7, when: "NOT gpio1.di5 AND S.BLINK_1HZ"}   # red blinking: door open
safe_state:
  exempt: [gpio1.do7]
alarms:
  - {bit: S.PLC_EMERGENCY, text: "PLC stopped the robot", level: error, toast: false}
```
The door opens → the rung fires once → the supervisor's `trigger_emergency` is called, every
controlled output takes its safe value (the red lamp is exempt and keeps blinking). Closing the door
does **not** restart anything: the operator resets with `reset_fault`, and the cycle starts again by
its own `START`.

---

# Part P – Troubleshooting

| Symptom | Look at | Fix |
|---|---|---|
| nothing happens on any output | `S.SAFE_STATE`, `S.EMERGENCY`, `S.DI_OK`, `S.SUPERVISOR_OK` in `get_bits` | reset the robot fault; start the controllers; bench: `require_supervisor:=false` |
| `No program running: … line N` | the message names the line and the rule | fix, `nextplc_check`, `load_program` |
| an output never switches | is it **in the program**? (`q_controlled`); is there an `out:` with the right condition? `rung_results` in `/nextplc/state` | add/correct the rung |
| `set_bits refused: M11 is driven by rung 3` | the BT writes a bit a rung owns | let the BT write another M bit and map it with a rung |
| `SetBit` fails after 500 ms | PLC not running / wrong address / bit driven by a rung (see the runner log) | `ros2 topic echo /nextplc/state --once` |
| `WaitBit` never succeeds | the bit never gets the value; stale state (`max_age_ms`) | check the rung that produces it; check `/nextplc/state` rate |
| `IO fault: gpio1.do1 not applied` | the GPIO / DO controller is not active or refused the command (its log) | activate the controller; the PLC retries every second |
| an output flickers between two values | something else writes it too (old `DoControl` node, terminal) and `reassert_outputs` undoes it | remove the other writer or take the output out of the program |
| a counter counts at start-up | the input was already 1 at load? No – edges need the 0 first. Check for bouncing contacts | debounce: `up: "ON_FOR(gpio1.di6, 50ms)"` |
| timer too short/long | `scan_period_ms` in `/nextplc/state` should be ~10 | CPU load; raise `scan_ms` |
| forgot which outputs are free | `q_controlled` in `/nextplc/state`; log line *controls N of 32* | – |
| everything went to safe state, robot stopped, `S.PLC_EMERGENCY` = 1 | an `emergency:` rung fired: log *EMERGENCY from the program: <text>*; `/nextplc/alarms` | remove the cause, `reset_fault` on the supervisor; if the service was unreachable the PLC keeps calling it every second |
| a retained default (`move … when S.FIRST_SCAN AND R10 == 0`) keeps its old value after editing the file | the register is retained; the file only writes it while it is 0 | `set_bits <name> <value>`, or set it to 0 and reload |
| `.plc sentence programs are not supported any more` | an old `.plc` file in `program_file` / `load_program` | write the program in YAML |
| `block 'cylinder' not found; looked for: …` | the block file is not in `<program dir>/blocks`, `block_dirs` or the installed library | copy it there, or give the full path in `use:` |
| `port 'extend_cmd' (out) is not connected` | a required port has no address | add it to `with:` (open only optional ports) |
| a block instance behaves one scan "late" | block rungs run after the program's own rungs (file order) | read the sensor itself instead of the block's computed local |
| a scenario fails on the first line | the simulator starts with one scan (clock = 10 ms); `EXPECT` after `SET` runs the next scan | use `WITHIN` for anything that takes a timer |

---

# Appendix – Quick reference card

```
ADDRESSES   joint1..6 . di1..di8 | do1 do2 do3 pi_p      gpio1 . di1..di8 | do1..do8      M0..M127   R0..R31
SYSTEM      S.AUTO S.SAFEAUTO S.JOG S.ARMED S.EMERGENCY S.ESTOP S.STANDSTILL S.ANY_FAULT S.IO_FAULT
            S.DI_OK S.SUPERVISOR_OK S.FIRST_SCAN S.BLINK_1HZ S.BLINK_2HZ S.PROGRAM_OK S.SAFE_STATE S.PLC_EMERGENCY
SEQUENCE    seq.<name>.step   seq.<name>.active   seq.<name>.<step>

RUNGS       - {out: Q|M, when: "...", ton|tof|tp: 500ms|R10}  coil (+ timer; R10 = ms from a register)
            - {set: Q|M, when: "..."}  - {reset: Q|M, when: "..."}   latch (lower rung wins)
            - {toggle: Q|M, when: "..."}                        flip on rising edge
            - {count: R, up: "...", down: "...", reset: "...", preset: N|R, done: Q|M}
            - {move: R, value: N|expr, when: "..."}             R = value while when (no when = always)
            - {calc: "R2 = R0 * 2 + R1", when: "..."}
            - {emergency: "...", text: "..."}                   rising edge -> robot emergency + safe state
EXPRESSION  a AND b   a OR b   NOT a   ( )   RISE(a)   FALL(a)   ON_FOR(a, 2s|R10)   OFF_FOR(a, 500ms)
            == != < <= > >=   + - * / %   TRUE FALSE        OR < AND < NOT < compare < +- < */%
SEQUENCE    - name: s / start: "..." / abort: "..." / steps: [{name, do: [..], next: "...", timeout: 2s, on_timeout: M}]
ALARM       - {bit: M30, text: "...", level: info|warning|error, toast: true}
SAFE        safe_state: {default: 0, gpio1.do1: 1, exempt: [gpio1.do7]}        retain: [R0, R2]

TOPICS      /nextplc/state (50 Hz)  /nextplc/alarms  /nextplc/program (latched)  /nextplc/set_bits (in)
SERVICES    /nextplc/set_bits  /nextplc/get_bits  /nextplc/load_program  /nextplc/force_bit
BT NODES    SetBit  PulseBit  WaitBit  CheckBit  SetRegister  GetRegister     (port: address="M10")
CHECK       ros2 run nextplc nextplc_check program.yaml
SIMULATE    ros2 run nextplc nextplc_sim program.yaml scenario.sim [--csv trace.csv]
BLOCKS      blocks: - {use: cylinder, as: clamp, with: {request: M10, extend_cmd: gpio1.do1, ...}}
            cylinder two_hand_start motor_starter conveyor tower_lamp debounce part_counter bt_handshake door_guard blinker
SCENARIO    SUPERVISOR AUTO | SET x v | PULSE x 100ms | LINK out -> in AFTER 300ms [INVERT] | UNLINK in | TOGGLE in EVERY 200ms
            WAIT 2s | AT 1s | EXPECT x v [WITHIN 2s] | EXPECT x STAYS v FOR 2s | EXPECT [NO] ALARM M30 | EXPECT [NO] EMERGENCY
RELOAD      ros2 service call /nextplc/load_program nextplc/srv/LoadProgram "{path: ''}"
```
