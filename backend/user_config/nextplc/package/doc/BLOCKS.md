# nextplc – The block library

A **block** is a piece of logic that has been written once, tested in the simulator, and can be used
in any program by connecting its **ports** to your addresses – like a function block in a PLC, or a
relay module you wire into a panel. A cylinder with two end sensors, a motor starter with contactor
feedback, a two-hand start, a lamp tower: most cells are 80 % such blocks and 20 % cell-specific
rungs.

Blocks do not add anything to the engine: when the program loads, the block's rungs are copied into
your program with the port names replaced by your addresses. `nextplc_check` shows exactly what was
expanded, and every rule of the manual (one owner per bit, safe state, controlled outputs …)
applies to the expanded rungs like to your own.

## 1. Using a block

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

## 2. The library (`blocks/`)

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

## 3. Writing your own block

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
`ros2 run nextplc nextplc_sim my_test.yaml my_test.sim` (doc/SIMULATOR.md). Your own blocks go to
`/home/nextup/user_config_files/plc/blocks/` (or `blocks/` next to the program) and are found like
the library ones.
