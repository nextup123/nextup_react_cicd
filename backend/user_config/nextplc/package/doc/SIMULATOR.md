# nextplc – The simulator

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

## 1. A scenario, line by line

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

## 2. Statements

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

## 3. What the simulator does for you

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

## 4. Patterns

**Commissioning test of a cell**: write the scenario from the specification ("part arrives →
clamp closes within 500 ms → robot asked"), run it on the office PC, then on the robot replace the
`LINK`s by the real sensors. Keep the scenario in the project: it is the acceptance test.

**Reproduce a field problem**: take the sequence of inputs from the log (`/nextplc/state` or the
alarm history), write them as `AT … SET …` lines, and watch the rung results.

**Test a block** (what `blocks/tests/*.sim` do): one instance with raw addresses, `LINK` the
feedback, exercise the normal path, then `UNLINK` to provoke the fault, `PULSE` the reset.

**Timing check of a program**: `WATCH` the output, `SET` the input, let `EXPECT … WITHIN`
report the real reaction time (`at 380 ms`), compare with the specification.

## 5. Limits

* Only digital I/O and the supervisor bits are modelled; no motion, no MoveIt. The BT is replaced
  by `SET` / `PULSE` on the M bits it would write.
* Time is simulated (a scan per statement step), so a 10 s scenario runs in milliseconds – it is
  not a real-time test of the controller PC.
* `LINK` is a pure delay; a sensor that bounces or a cylinder that is slower under load is written
  as a second `LINK` / a `TOGGLE` in the scenario.
