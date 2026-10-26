# NextUp Robot Console (React)

**Version history:** v0.9 checkpoint (2026-10-19) = everything up to round 14 (saved as `nextup-react-v0.9.zip`). v1.0-dev adds in-app tutorials (see "Round 15" at the end).

The NextUp web UI rebuilt as one React app. The 7 iframe pages are now routes in a
single page application with one shared layout, one WebSocket connection, one data
cache and one light theme. The Node backend is the original one with a few
targeted fixes (listed below).

```
nextup-react/
├── backend/    Express + WebSocket + ROS 2 bridge (your original backend, lightly patched)
└── frontend/   Vite + React 18 app (source in frontend/src, production build in frontend/dist)
```

## Install

Requirements: Node.js 18+ (tested with Node 22).

```bash
cd backend  && npm install      # rclnodejs is optional: it builds only where ROS 2 is installed
cd ../frontend && npm install
```

On the robot, source ROS 2 before `npm install` in `backend/` (as before) so `rclnodejs` builds.

## Run on the robot (production)

```bash
cd frontend && npm run build    # writes frontend/dist (a fresh build is already included)
cd ../backend && npm start      # http://<robot-ip>:3000
```

The backend serves the React app from `../frontend/dist` (override with `FRONTEND_DIST=/path`)
plus all APIs and the WebSocket on port 3000. Open `http://localhost:3000`, or the robot's IP
from a tablet or laptop: all URLs are relative now, so the UI works from other machines too.

The old pages are still served at their old addresses (`/doDiWeb/`, `/mainTree/`,
`/clientControl/`, `/error-handling/`, `/projectManagerEn/`) for comparison during the
switch-over. Delete `backend/public/` once you no longer need them. (The old Point Planning and
Path Planning pages were removed together with the features they used. The old pages also no
longer show live log lines, which now arrive in batches as `LOG_MESSAGES`.)

## Develop

```bash
cd backend  && npm run dev      # API + WebSocket on :3000
cd frontend && npm run dev      # React app with hot reload on :5173, proxies to :3000
```

Point the dev server at another backend with `NEXTUP_BACKEND=http://192.168.1.50:3000 npm run dev`.

### Without ROS (simulation)

When `rclnodejs` is not installed (any machine without ROS 2), or with `npm run sim`
(`NEXTUP_SIM=1`), the backend runs a **simulated robot** that simulates the new controller stack behind the same
services: supervisor (profiles, phased mode changes and resets, emergency latching, speed
override), motion server (homes, go-to point / joints / pose, sequences, programs, dry runs, stop),
drive state broadcaster (error log, fault counters, IO watch) and the BT runner (running node,
step mode, breakpoints, operator questions), plus joint states, DI/DO/GPIO echoes and logs.
`POST /robot/sim/fault|estop|operator|btfail` injects events for testing (simulation only); its
files go to `backend/user_config/sim/`. The top bar shows an
orange **Simulation** badge so it can never be mistaken for the real robot. On a machine with
ROS 2 installed, the real bridge is used and an init failure still stops the server, as before.

The backend still reads and writes project data under `/home/nextup/...` (see
`backend/config/path.js`), so on a dev machine those folders must exist.

## New controllers (nextup_controllers + motion server)

Commands now go through **services** with a real answer; status comes from a few topics. The web
no longer writes drive modes, SDO overspeed values, resets or emergencies itself: the motion
supervisor is the only writer, every motion goes through `nextup_motion_server`.

| UI action | Now calls |
|---|---|
| Mode switch (top bar chip, Teach Points) | `/nextup_motion_supervisor/set_operation_mode`, then follows `~/status` (phases shown live) |
| RESET | supervisor `reset_fault` (refused while the E-stop button is pressed; ends in JOG) |
| E-STOP | supervisor `trigger_emergency` (compatibility topic only as a fallback) |
| Speed override | supervisor `set_speed_override` (the answer shows the effective, capped value) |
| HOME | motion server `home` (active home, another home, single stage or dry run); from JOG it switches to SAFEAUTO first |
| Move to point | motion server `goto_point` (PTP / LIN, m/s speed, approach / retract, test without moving, live progress, Stop) |
| Stop | motion server `stop` |
| START | supervisor AUTO, confirmed, then `/control_start_bt` (a refused AUTO stops the start) |
| Jog frame | `/ui_command_node/set_frame` |
| Planner OMPL / PILZ | motion server `goto/set_config` `default_planner` |

Where the new information is in the UI (existing pages and names are kept):

- **Top bar:** mode chip (profile, phase while switching, effective speed) with a panel for mode,
  speed override, relaxed latching, overspeed limits per mode, reset motion server and clear plan
  cache; a motion chip with progress, stage and Stop while the motion server moves; HOME is a
  split button (other homes, all joints at once, dry run, manage homes). A banner under the top
  bar shows a latched emergency with its cause and Reset, an isolated joint, or a paused program
  with Step / Continue. Questions from the program (`WaitForOperatorAck`) open on every page.
- **Teach Points:** move dialog as above; jog settings menu adds go to joints / pose, teach a home
  here, homes, and tool (TCP) offset; TCP speed badge; point menu "Save as a home".
- **Robot Program:** the running node is highlighted live, the last failed node for 30 s; the run
  menu next to the title has pause / step / resume; right-click a node to pause before it.
  Matching is by node name, so nodes with the same name light up together.
- **Client Control:** emergency cause, current node and cycle, paused state, "Finish this cycle,
  then stop" (`/control_stop_bt`), effective speed after the supervisor's cap.
- **Diagnostics → Robot records:** supervisor events, drive error log, fault counters, motion log
  and black-box recordings (CSV download).
- **IO Control → Signal watch:** watched inputs with live level and last edge, add / remove, and
  a 60 s trace of every IO change.

REST API for all of it: `backend/ros/robotRoutes.js` (mounted at `/robot`); names of every
service and topic: `backend/ros/interfaces.js`.

### Message bindings (important after a controller update)

rclnodejs decodes messages with JavaScript layouts generated from the installed `.msg` files. If
`nextup_joint_interfaces` or `nextup_utility_interface` change and the layouts are not
regenerated, Node crashes with heap corruption. The backend now hashes those packages' interface
files at start and runs `generate-ros-messages` once when they changed (source both workspaces
before `npm start`). `NEXTUP_AUTOGEN_BINDINGS=0` turns the automatic run off; then run
`npx generate-ros-messages` in `backend/` yourself. `GET /system/bridge` and
`GET /robot/capabilities` report the result and any message type without bindings (that topic is
skipped instead of crashing).

### Fixed by the new interfaces

- Joint positions are read from `/joint_states` (they are no longer in `/nextup_joint_states`).
- Driver inputs use the `di1..di8` fields (the old code read `sto1/sto2/edm`, which do not exist).
- `/nextup_driver_status` is gone; drive state comes from `/nextup_joint_states`.
- **Safety:** the web's own SDO overspeed writes (`ros/modeOverspeed.js`) are removed. They
  bypassed the supervisor, which is now the only writer of the overspeed thresholds per mode.

### Not available or not tested

- `run_program` / `finish_program` are in the documentation but not in the uploaded source. The
  backend has routes for them and edits `planning_data/programs.yaml`; running works only when the
  motion server offers the service (`GET /robot/programs` returns `canRun`).
- `get_io_watch` is not running on every install. IO Control then hides the Signal watch card and
  shows a one-line notice with a "check again" button.
- Tested here against the simulator only, not against the real controllers.

### No hard locks

- Every dialog closes with Esc, its close button or a click outside, also while the robot moves
  (closing never stops the motion; the top bar keeps showing it and has its own Stop).
- **Stuck "Verifying 100 %" (seen on the real robot):** the last "verifying" status could wait in
  the 5 Hz gate and be delivered right after the final "succeeded", overwriting it. The backend
  now drops a pending status when a final one goes out (`LatestGate.drop()`), the browser ignores
  a non-final status for a motion that already finished, and a watchdog settles a motion whose
  status stream has been quiet for 4 s (the server publishes continuously while a motion is active).
- A question from the program (`/bt_operator_request`) can be closed; a badge in the corner
  reopens it until it is answered or times out.
- A page that crashes shows a notice instead of a blank screen, and each top-bar widget and banner
  is isolated, so the sidebar, top bar and safety buttons always keep working.

### Layout saved on the robot

Panel sizes, open tabs and other layout choices are kept in `localStorage` under `nextup.*` keys
and mirrored to `backend/user_config/ui_prefs.json` (`GET/PATCH/DELETE /ui-prefs`). At startup the
server's copy is loaded before the app, so the layout is the same in a new browser or on another
computer. Resizable (drag the handle, double-click to reset): Teach Points columns, IO Control
columns and IO sequences / Signal watch, Client Control setup / IO, Diagnostics logs / errors,
Robot Program library panel.

### Themes and modes

The palette button next to **Power** in the sidebar opens the Theme window: 8 theme colours
(Indigo, the original, Royal blue, Sky, Cyan, Teal, Violet, Orchid, Graphite) and the modes
**Light**, **Gray** (low glare, no pure white), **Dark** and **Auto** (follows the computer's light /
dark setting). Changes apply at once, also to the 3D view's background, floor and grid. The choice
is the `nextup.theme` preference, so it is saved on the robot like the layout; `index.html` applies
the browser's copy before the first paint, so the page never flashes in the wrong theme.

Safety colours do not belong to a theme: emergency banner, E-STOP, fault red, OK green and warning
amber keep their hue and meaning in every theme (only their light tints and text shades adapt to
the mode so they stay readable).

How it is built: `src/lib/themeList.js` lists the accents and modes; `scripts/gen-themes.mjs`
generates `src/styles/themes.css` (one `--primary-*` scale per accent × mode) and checks contrast:
white text on filled buttons, the selected-item text on its tint, and accent text on the page all
reach at least 4.5:1 in every combination. Run `node scripts/gen-themes.mjs` after changing the
list. Mode neutrals and status tints are in `src/styles/tokens.css`; components use tokens only
(`--surface`, `--text-muted`, `--primary-ink`, `--danger-fg`, ...), never fixed colours.

### 3D view: robot models, visual modes, CPU

**Robot models.** The model list in the 3D view's header shows every robot description in the
robot's urdf folder (`/home/nextup/NextupRobot/src/nextup_moveit_config/urdf`, set in
`backend/config/path.js` → `robotModelPaths`, or `NEXTUP_URDF_DIR` / `NEXTUP_WS`). A new
`*.urdf.xacro`, `*.xacro` or `*.urdf` dropped there shows up the next time the list is opened, no
code change. The model ROS loads (`robot_type` in `config/robot_nextup.urdf.xacro`) is marked
**(ROS)** and is the default. The backend expands xacro with the ROS `xacro` tool when it is on the
PATH (source the workspaces before `npm start`), otherwise with a built-in expander (properties,
args, `${}` expressions, `$(find)`, include, if / unless, macros). `package://` meshes are found in
`src/` and `install/` of the workspace and in `$AMENT_PREFIX_PATH`. The choice is saved on the
robot (`backend/user_config/robot_model.json`) and every open browser switches with it.

**Simulation follows the model.** With `npm run sim`, the simulated robot takes joint limits and
kinematics from the selected model: Cartesian values are its real forward kinematics (tool link
`end`, plus the TCP offset), Cartesian jog moves the tool in a straight line in the base or tool
frame through the model's Jacobian, go-to pose solves its inverse kinematics (refused when there is
no solution), and joints stop at their limits. Only the meshes differ in the 3D view. Joints are
matched by order (`joint1..joint6` in all three current models).

**Meshes.** STLs are prepared on the robot once (welded, sharp edges kept, simplified with
meshoptimizer) at three detail levels and cached in `backend/user_config/mesh_cache`:

| Detail | Triangles (Robot 1) | Download (all links) |
|---|---|---|
| Low | about 12 % (5.3k) | 139 KB |
| Medium | about 35 % (16k) | 389 KB |
| Full | all (44k) | 770 KB (the STLs are 2.2 MB) |

**Visual modes and settings** (buttons and gear in the 3D view header; saved on the robot as the
`nextup.view3d` preference):

| | Performance | Balanced (default) | Visuals |
|---|---|---|---|
| Max rate | 15 Hz | 24 Hz | 60 Hz |
| Shading | simple | shaded | realistic (metal, reflections) |
| Mesh detail | low | medium | full |
| Shadows, anti-aliasing | off | off | on |
| Resolution | 75 % | 100 % | sharp (screen) |
| Smooth motion between updates | off | on | on |

The settings window also has robot colour (from the model or any colour), lighting (soft, studio,
bright, brightness), max rate in Hz, mesh detail, resolution, anti-aliasing, shadows, smooth motion,
grid, floor, base axes, tool frame, background and a render-stats overlay. Changing one value turns
the mode into *Custom*.

**Header and settings panel.** The 3D view header reads *3D view | robot model | Points on/off*.
The settings panel floats over the view: drag it by its title bar, fold it to the title bar with the
arrow, close it with ×. Its position is saved (`nextup.view3d.panel`) and kept inside the view when
the view is resized.

**Teach points in 3D.** Every point of the Teach Points list is shown as a small orange ball with its
name, in the robot base frame (the selected point is green). The position comes from the point's
joint values through the shown model's kinematics, else from its stored Cartesian values. The
*Points* button in the header shows or hides them; the choice is saved in `nextup.view3d`
(`points`). Balls and labels are only rebuilt when the list or the model changes, so they cost
nothing while the robot is still.

**Why it uses little CPU.** The old view (NexSim bundle) drew 60 frames per second all the time,
with shadows, whether anything moved or not. The new renderer (`frontend/src/pages/points/viewer3d/`,
three.js) draws a frame only when the joints, the camera, the size or a setting change, never more
often than the mode's rate, and not at all while the view is off screen, the tab is hidden or the
page is closed. Joint changes under 0.0001 rad are ignored.

Measured in the simulator, Teach Points open at 1600 × 900, Chromium **without a graphics card**
(software rendering, the worst case), CPU of all browser processes in % of one core:

| | Robot still | Robot moving |
|---|---|---|
| Old 3D view | 355 % | 349 % |
| Performance | 2 % | 30 % |
| Balanced | 2 % | 84 % |
| Visuals | 2 % | 169 % |

(The page itself without any 3D drawing uses about 24 % while the robot moves.) With a graphics
card the drawing cost moves to the GPU, so the moving numbers are lower on a real PC.

### NexRoot Runner (live behaviour tree)

Robot Program stays the editor (one subtree at a time). **NexRoot Runner** (`/runner`, under
Operation, or "Open runner" in the live-run menu of Robot Program) shows the *running* tree as
`bt_debug_pkg` publishes it: the main tree with every subtree attached. The pop-out button opens
it in its own browser window (`/runner-window`), so editor and runner can sit side by side.

- **Colours (Groot v2)**: orange running, green success, red failure; lighter green / red for
  nodes that finished earlier in this cycle (BT.CPP resets them to IDLE), dashed for halted.
- **Follow**: the view follows the running node; a manual pan or zoom pauses following for 6 s.
  When a cycle fails the view jumps to the failed node, opens its path and shows the Failure tab
  (node, error, path, port values from `/control_logic_bt/events`). Both can be switched off.
- **State machine**: the bar shows the runner state (`/control_logic_bt/status`) and only the
  buttons the runner accepts in that state, plus one line saying what to do next:

  | State | Buttons |
  |---|---|
  | NO_TREE | Validate, Load |
  | IDLE | Start (cycles, Normal / Dry run / Sim), Load |
  | RUNNING | Pause, Stop, Finish cycle, Abort |
  | PAUSING | Resume, Stop, Abort |
  | PAUSED | Resume, Next (one action), Stop, Abort |
  | STOPPING | Abort |
  | FINISHING | Pause, Stop, Abort |
  | FAILED | Reset, Start, Load |

  "Previous" is not offered: neither control_logic_bt nor bt_debug_pkg can step back.
- **Tick level** (bt_debug_pkg debug services): right-click a node for a breakpoint (any result
  or failure only); when the tree is held, Tick once / Continue ticking appear.
- **Side panel**: Run (running path, cycle, times, counts), Failure, Node (status, time, ports,
  "Edit in Robot Program" which opens that subtree and node in the editor), Events, Data
  (blackboard).
- Large trees (over 160 nodes) open with nested subtrees folded; the running and failed paths
  open by themselves.

**CPU.** The browser never subscribes to the debug topics. The backend reads the tree once
(`/control_logic_bt/tree`, latched; the page fetches it via `GET /robot/bt/structure` only when
its hash changes) and, *only while a runner page is open*, subscribes to
`/control_logic_bt/events`. Event headers are peeked from the raw message (uid and status, no
decode); a full decode happens only for failures. The page gets one character per node at most
5 Hz (`BT_LIVE`, 200 ms) and the runner status at 4 Hz, and only changed nodes are restyled.
Measured in the simulator with a leaf finishing every 0.3 to 0.6 s: about 6 % of one core for
the runner page, under 1 % for other pages. When the last runner page closes the events
subscription is dropped.

**Simulator.** `npm run sim` now runs a real behaviour tree runner with the same state machine,
topics and services (`backend/ros/simBtRunner.js`). It loads `main_tree.xml` from the control
logic folder if present, otherwise the demo in `backend/config/sim_trees/` (main tree, initPose,
pick, place, recover subtrees). `POST /robot/sim/btfail` makes the next action fail;
emergency latch aborts the run.

**Real robot.** Needs `control_logic_bt_interfaces` bindings: the backend regenerates them at
start like the other packages (see Message bindings). REST: `GET /robot/bt/structure`,
`GET /robot/bt/trees`, `POST /robot/bt/runner/start`, `POST /robot/bt/runner/<stop|finish_cycle|abort|pause|resume|step|reset>`,
`POST /robot/bt/runner/load`, `POST /robot/bt/runner/validate`. Not tested against the real
runner yet (no ROS in the build sandbox).

### Emergency banner

Flat, solid red bar across the page with Reset and the fold button; no glow and no animation.

## Pages

| Route | Was | What it is |
|---|---|---|
| `/projects` | Project Manager | Active project, save / save as / versions / restore, create, load, rename, copy, delete, autosave |
| `/points` | Point Planning | **Teach Points**: three resizable columns (point list, 3D view, robot motion). The 3D view has a robot model list, visual modes and a settings window (see above). Teach/edit points, move-to, jog (joint + cartesian), mode SafeAuto/Jog/Auto, planner, servo, jog frame, YAML, access manager, keyboard pendant, gamepad. The 3D view can be detached into a floating window; drag it back onto the strip to attach it |
| `/programs` | (new) | **Motion Programs**: create and edit the named motion programs of `programs.yaml` (motion_server_pkg), check them against the motion server rules, preview the path, dry run / run / finish / stop. See "Motion Programs" below |
| `/io` | IO Control | Live driver DI/DO matrix, GPIO panel, IO sequence list with a live switch / push button / indicator on every step. The pin icon floats that control over every page |
| `/runner` | (new) | **NexRoot Runner**: the complete running tree (main tree with every subtree expanded) with Groot colours, the runner state machine with only the valid buttons and a guide, auto-focus on the failed node, breakpoints and tick stepping. Also opens as its own window (`/runner-window`). See "NexRoot Runner" above |
| `/tree` | Main Tree | **Robot Program**: behaviour tree editor. Full-width tree (or ladder) view; the library (subtrees, run paths, DO/DI, editable quick add) slides in from the left; the selected node's settings float at the top-right (drag, fold, close). One shape per node kind, colour by what the node does, animated expand/collapse remembered per subtree, Ctrl+C / Ctrl+X / Ctrl+V and Ctrl+D with fresh IDs and names. **Touch screens** (tablet, teach pendant): tap a node for a bar of finger-sized buttons (add inside / after with quick-add chips, copy, cut, paste, duplicate, move, fold, edit, more, delete), hold a node and drag it onto a sibling to move it, hold without moving for the full menu, pinch to zoom; the mouse and keyboard work exactly as before (`pages/tree/touch.js` switches on the last pointer used) |
| `/client` | Client Control | Operator screen: START / STOP / EXIT, run mode, speed, CNC, cycle counters and times, DI/DO cards |
| `/diagnostics` | Error Handling | Live logs, error history, fault lookup, ROS monitor, commands and description editors |

On every page the top bar shows one combined robot status (green: Drives, Faults, Homed and E-Stop
all active; orange: some; red: none). Click it to show the four signals with a dot per joint. It
also shows the connection state, robot messages, and **Home**, **Reset**, **Stop** (old "Motion
reset") and **E-STOP**. IO controls pinned on IO Control float over every page; drag them by the
grip, their positions are remembered in the browser.
The sidebar shows the active project (with an "Unsaved changes" marker), system time, uptime,
load, the Power menu and the Theme window. Banners that must be seen (emergency, isolated joint,
paused program) float across the full width of the page without moving it, and fold into a small
badge.

## Frontend structure

```
frontend/src/
├── main.jsx, App.jsx, nav.js      entry, routes, sidebar menu (pages are code-split)
├── layout/                        shell: sidebar, top bar, status, safety buttons, logs drawer, power, boot screen
├── components/ui/                 shared components (Button, Card, Modal, Field, Segmented, Switch, ...)
├── styles/                        tokens.css (modes, status colours), themes.css (generated accents), base, components, layout
├── lib/
│   ├── api.js                     fetch wrapper (relative URLs, readable errors)
│   ├── ws.js, useWs.js            the single WebSocket (auto-reconnect) + subscribe hook
│   └── queries.js                 shared server data (points, paths, DO/DI lists, settings, project) + invalidation
├── store/
│   ├── robot.js                   live robot state from the WebSocket (one copy for all pages)
│   ├── projectSession.js          unsaved-changes stream + autosave (runs on every page)
│   ├── toast.js, confirm.js       notifications and confirmation dialogs
└── pages/<area>/                  one folder per page
```

Shared data: data used by several pages is fetched once through `lib/queries.js` and cached. When a
page changes it, it calls `invalidate.points()`, `invalidate.io()` etc., so the other pages update
(for example, a point taught on Teach Points appears at once in the tree editor).
Loading another project refreshes everything (`invalidate.all()`) instead of reloading 7 iframes.

## CPU use (topic rate limits)

Every ROS topic the backend forwards to the browser is rate limited in the Node process
(`backend/ros/rateLimit.js`, `subscribeState` in `ros/LightweightROSBridge.js`):

| Data | Max rate to the browser |
|---|---|
| Joint positions, joint values, cartesian values | 5 Hz |
| Driver status, supervisor status, TCP speed, digital inputs / E-stop, GPIO, DO echoes, behaviour-tree status | 4 Hz |
| Motion server status | 5 Hz (the final result is sent at once) |
| BT blackboard | 1 Hz |
| Rosbridge status, active nodes | 1 Hz |
| Log lines | every line kept, sent in batches 4 times per second |

- State topics are subscribed **raw** (rclnodejs `isRaw`): a message costs only a buffer copy and
  just the newest one is decoded, at the rate above. If raw decoding fails on a robot, that topic
  falls back to a normal subscription by itself (logged once); `NEXTUP_RAW_SUBS=0` turns raw mode off.
- The browser gets a state message only when the value changed; a newly opened page gets the last
  value of each at once.
- `live_logs.json` and `logs.json` are written at most once per second (they were read and fully
  rewritten for every log line). `/uptime` no longer spawns a process on every poll.

Measured with a bench that drives the bridge with synthetic "tree running" traffic (100 Hz joint,
driver, DI and GPIO topics, 50 Hz values and BT status, 20 log lines/s, one browser connected):
the Node process went from **9.8 % to 2.2 %** of one core, of which 1.4 % is the bench's own traffic
generator, and WebSocket traffic from 634 to 19 messages/s. The bench cannot include rclnodejs's
own per-message decoding, which the raw subscriptions also remove, so the drop on the robot
should be larger than this. Measure on the robot with `top -p $(pgrep -f "node server.js")`.

## Backend changes

| File | Change | Why |
|---|---|---|
| `package.json` | `rclnodejs` moved to `optionalDependencies`; added the missing `cors` and `ws`; scripts `start`, `dev`, `sim` | `npm install` failed on machines without ROS; `cors`/`ws` were used but not declared |
| `ros/LightweightROSBridge.js` | Loads `rclnodejs` lazily; calls `loadPlannerState()` in the constructor (default PILZ) | Allow the simulation fallback; the saved planner choice was never loaded, so `/ros/plannerState` returned no planner after a restart |
| `ros/SimROSBridge.js` (new), `ros/rosService.js` | Simulated robot when ROS 2 is unavailable or `NEXTUP_SIM=1` | Run and test the UI without the robot |
| `robotModel/` (new: `robotModels.js`, `xacro.js`, `urdf.js`, `meshes.js`, `kinematics.js`, `routes.js`), `config/path.js` (`robotModelPaths`) | `GET /robot-models`, `GET /robot-models/model/:id`, `GET /robot-models/mesh/:id?detail=`, `PUT /robot-models/selected`; simulator takes limits and kinematics from the selected model; dependency `meshoptimizer` | Load any robot description from the robot for the 3D view and simulate it as it is |
| `server.js` | Serves `frontend/dist` with client-side routing; `GET /system/bridge` (real vs simulated); `express.json` limit 5 MB; `app.post("driver", ...)` → `app.use("/driver", ...)` | New frontend; the driver routes were never reachable |
| `routes/driverRoutes.js` | Added the missing `exec` import | Start/stop EtherCAT would have crashed with `exec is not defined` |
| `controller/errorLogsController.js` | Handles the spawn `error` event in "open terminal" | A missing or non-executable terminal script crashed the whole backend |
| `service/pointPlanningBtService.js` | Empty `points.yaml` is treated as an empty point list | Point Planning broke on a new blank project |
| `utils/pm_utils/projectTemplateGenerator.js` | A **blank** project gets valid empty XML/YAML skeletons | Blank projects contained comment-only XML, so IO Control, Main Tree, Client Control and Path Planning all returned HTTP 500 |

| `ws/wsServer.js`, `ros/rateLimit.js` (new), `ros/LightweightROSBridge.js`, `ros/SimROSBridge.js` | Topic rate limits, raw subscriptions, changed-only state messages, batched logs | CPU while a tree runs (see above) |
| `ros/rosHelper.js`, `utils/pm_utils/mutationWatcher.js` | Log files written in 1 s batches; the project watcher ignores log files | Each log line rewrote a 2000-entry file |
| `server.js` | `/uptime` computed in-process | It spawned `uptime` every 5 s per open browser |
| Removed: Path Planning | `/path-planning`, `/path-testing` routes, their controllers/services, the unused path/sequence runner files, WS `MOTION_COMMAND` / `START_MOTION` / `AUTO_GENERATE_XML` / `AUTO_GENERATE_SEQUENCE`, `/ros/startPlanning`, the motion-BT status topics | Path Planning was removed |
| `controller/mainTreeController.js`, `routes/mainTreeRoutes.js` | `POST /main-tree/pasteNode` (paste a copied node with its children inside or after a node, any subtree); `copyNode` (Ctrl+D) gives every copied node a fresh ID and a generated `<Type>_<HHMMSS>` name instead of appending `_copy`, allows subtree links, and both return the new node's ID | Copy and paste in the tree editor; easier debugging of copies |
| Removed: Point Planning extras | WS calibration (`/ws-calibration`, its controller, service and ROS adapter), points file selection (`getPointFileName`, `getPointsBackupFileNames`, `savePointFile`, `loadBackupFile`, `createNewFile`, `deleteBackupFile`), the frame orientation viewer | Files are managed by Project Manager |

| `ros/interfaces.js`, `ros/bindings.js`, `ros/robotOps.js`, `ros/robotRoutes.js` (new); `ws/wsHandler.js`, `ros/rosController.js`, `ros/LightweightROSBridge.js`, `ros/SimROSBridge.js` (rewritten) | New controller stack: services instead of topics, `/robot` API, bindings check | See "New controllers" above |
| `routes/uiPrefs.js` (new), `server.js` | `/ui-prefs`: layout preferences shared by every browser | Panel sizes stay as last set, also in a new browser |
| `ros/rateLimit.js`, `ros/LightweightROSBridge.js` | `LatestGate.drop()`; a final motion status clears the pending one | A late "verifying" overwrote "succeeded" and left the Move dialog stuck |
| Removed: `ros/modeOverspeed.js`, `ws/LightweightWSHandler.js` | SDO overspeed writes, unused old handler | The supervisor owns overspeed |

Other WebSocket message types and HTTP endpoints keep their old names and shapes. Project files
(`plan_path.xml`, `paths.yaml`, `calibration.yaml`) are still part of a project and copied by Project
Manager, so the robot side keeps finding them; only the web editors for them are gone.

## Notes for the real robot

- **Jog:** the jog buttons use the same `UI_COMMANDS` step commands as the old page (`+j1` repeated
  every 30 ms while held, `0j1` on release) and stop on release, pointer leave, window blur, tab
  hide, page change and connection loss. The `servo_jog.js` velocity stream (disabled in the old
  code) is available as an "experimental" option in the jog card's settings.
- **Client Control START** is enabled only when the robot reports `CONTROL_ACTIVE = true`, the same
  rule as before. Please confirm this on the robot.
- **Cycle counting** (`total_operations`) is still done in the browser, as before: it counts while
  the app is open, and two open browsers would both count. Moving it into the backend is the proper fix.
- Not tested against real hardware here: the real replies to motion-planning and auto-generate
  commands, real rosbridge, a physical gamepad.

## Round 10: status panels and compact runner tree (2026-10-12)

**Top-bar status, three panels.** The top bar has three status chips: **Joints** (the 5 × 6 matrix,
now with an **Isolation** row: a joint isolated after its fault under relaxed latching shows amber),
**Motion** (now always shown: running motion with stage, progress and Stop, otherwise "Idle · last:
Done") and the new **Program** chip (control_logic_bt runner state, current cycle, running action).
A click opens that chip's panel; the panels stay open until closed, sit side by side under the top
bar over the page (nothing on the page moves), and any or all three can be open at once. Each folds
to its header (chevron or double-click) and the open / folded set is remembered (`nextup.statusDock`).

- Joints panel: drives, faults, homed, E-stop, isolation per joint, position (deg), following error,
  CiA402 state, last error code, and the supervisor facts.
- Motion panel: "Ready to move" checks (the motion server's start checks: emergency, JOG, phase,
  armed, drives enabled, fault, isolated joint), the current or last motion in full (kind, target,
  PTP/LIN, planner, requested vs peak planned speed, speed scale, plan cache, path, error code in
  words, target joints), and the last 12 motions.
- Program panel: what to do now (same guide as the runner page), state, mode, cycles, cycle times,
  ticks, running actions with their breadcrumb, last change, the failure that stopped the run (or
  the last failed node from the log), slowest actions of the last cycle, a link to NexRoot Runner.

They read the existing live data only (`SUPERVISOR_STATUS`, `MOTION_STATUS`, `BT_ACTIVE`, and
`BT_RUNNER`, which the backend already sends at 2 Hz); the per-node tree stream stays off unless a
runner page is open. On narrow screens the chips shorten so the safety buttons always stay in view.

**NexRoot Runner: compact view.** The tree card has a **Compact | Graph** switch; Compact is the
default: one line per node like a terminal tree (├─ └─ guides, name, type, status, running time),
rows tinted by status, fold arrows, the last change at the bottom, and Tighter / Roomier row
buttons (density remembered). Follow, jump to failure, search, breakpoints and the context menu work
as in the graph. Live updates touch only the rows whose status changed (React does not re-render
the rows); measured in the simulator with a running tree: about 6 % of one core, about 9 % with all
three status panels open.

Files: `layout/StatusDock.jsx`, `layout/statusDock.css`, `layout/ProgramChip.jsx`,
`store/statusDock.js`, `pages/runner/RunnerList.jsx` (new); `layout/RobotStatus.jsx`,
`layout/MotionChip.jsx`, `layout/AppShell.jsx`, `store/robot.js`, `pages/runner/RunnerPage.jsx`,
`pages/runner/runner.css` (changed). No backend change. Tested in the simulator only.

## Round 10: Motion Programs page (2026-10-12)

**Where the file lives.** `programs.yaml` sits in the active project's `planning_data/` (the file the
motion server reads). New projects, from the default template and blank ones, get it with a starter
program `simple_move` (PTP home, LIN 50 mm down relative, LIN back to home). A project made before
this round shows a "Create programs.yaml" button. In sim mode without a project the simulator uses
`backend/user_config/sim/programs.yaml` and adds a `demo_all_motions` program.

**The page** (`/programs`, sidebar "Motion Programs" under Programming), three resizable columns:
- Programs list: search, New from a template (blank, starter, and the eight examples: pick and
  place, welding with weave, palletizing, ...), duplicate, rename, delete, a dot on the running one.
- Program: name, description, repeat (once / 2 / 5 / until finished), default speed and
  acceleration, tool and frame (saved; the motion server does not use them yet), a checks bar, the
  step list (drag to reorder, keyboard: Ctrl+S, Ctrl+Z / Ctrl+Y, Delete, Ctrl+D, Alt+arrows) and a
  path preview (top / front / side) drawn from the taught point coordinates.
- Side tabs: **Step** (motion cards, then "Defined by" choices that show only the keys that motion
  allows: point, offset, via, centre, radius, turns, pitch, angle, points, weave, speed,
  acceleration, blend, dwell, note), **Run** (loops, speed, a whole-program shift, dry run, run,
  finish, stop, live step, the `<RunProgram/>` line for a tree), **YAML** (this program, or the
  whole file as text).

**Rules.** `pages/programs/programRules.js` mirrors motion_server_pkg's checks (step shape, first
step PTP/LIN to a point, blend 0 on the last step, at a dwell, on and before Cartesian paths, weave
and orientation only where allowed, points that are not taught, missing joints for PTP). The same
file is copied to `backend/ros/programRules.js` so the server checks saves the same way; keep the
two copies identical. Every problem says why and most have a one-click fix. Hover any (i) for a tip.

**Saving** writes only the edited program back into the file (other programs and comments stay as
they were; a step's comment is its note), keeps `programs.yaml.bak`, and is refused if the result
would not parse.

**Backend:** `ros/programStore.js` (read, save, delete, reorder, raw text, create), routes
`/robot/programs*` in `ros/robotRoutes.js`, `list_programs` in `ros/interfaces.js`, sim support in
`ros/SimROSBridge.js` (runs programs through the same path builder with IK). Frontend packages
added: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (touch-friendly drag). Tested in
the simulator only.

## Round 11b: no file names on screen, system info, rest alerts

- **No paths or extensions in the UI.** `frontend/src/lib/plainText.js`: `plainName()` turns `dir/main_tree.xml` into `main_tree`, `plainText()` strips paths, file extensions and the words YAML/XML/JSON from free text. Every API error (`lib/api.js` ApiError) and every toast goes through it. Page texts were rewritten (Motion Programs, Teach Points, IO, Robot Program, NexRoot Runner, Projects, 3D view); "XML"/"YAML" buttons are now "Source"/"Text". Diagnostics and Settings still show real names. Use `plainName`/`plainText` for any new text that may carry a file name.
- **Menus inside clipping columns:** `Menu` has a `floating` prop (portal, fixed position, flips up and stays inside the window). Used by Motion Programs "New".
- **System info** moved to `layout/SystemInfo.jsx` + `systemInfo.css` (card style, rows turn amber/red). `/uptime` now also returns `uptimeSeconds` and `load` (numbers) and is asked once a minute.
- **Rest alerts** (limits in `REST_LIMITS` in SystemInfo.jsx): uptime ≥ 12 h popup (Skip/close, once per boot); ≥ 24 h critical card "needs a 30 min rest", minimisable to a pill, never closable until restart. 5-minute load ≥ 8 popup (closed until load is normal again), > 16 critical card. Dismissals are kept per browser in `localStorage["nextupLocal.restAlerts"]` (not mirrored).

## Round 11a: nav bar, status panels and Settings page (2026-10-13)

- **Top bar second row** (`.topbar-strip` in `layout/AppShell.jsx`): the emergency / paused banners and the status panels' headers sit in a row under the top bar, in the page flow. Pages start below it, so nothing is covered; the row disappears when empty. An unfolded panel's body still hangs over the page.
- **Draggable panels:** drag a Joints / Motion / Program panel sideways by the grip in its header; it swaps with the panel it crosses. Order kept in `nextup.statusDock` (`order`), reset in Settings › Display.
- **Chip states:** Motion shows *Ready to move* or *Inactive · reason* (not armed, JOG, emergency…) with a light red border (`lib/motionReady.js`, shared with the panel). Program shows *Stopped* whenever nothing runs, also after a run was started and closed, with the reason (*Process off*, *Ready · program*, *No program loaded*).
- **Stop button removed** from the top bar; a running motion is stopped from the motion chip.
- **Process switch** (`components/robot/ProcessSwitch.jsx`) on Client Control, the NexRoot Runner bar and the program panel.
- **Settings page** at `/setup` (gear beside the theme button in the sidebar; `/settings` is a backend API prefix). Sections in `pages/settings/settingsRegistry.jsx`: Robot (overspeed limits per mode), Point teach (homes, TCP offset, jog method), Display (theme, panel order), System (file locations from `GET /system/paths`). These left the Home menu, the mode chip and the jog panel menu.
- Backend: `btMonitor` drops a runner status older than 6 s (runner gone) so the UI reads Stopped; the sim reports the process as `running` / `stopped`.

## Round 12a: floating status panels, Teach Points buttons, Program Idle, hidden paths (2026-10-14)

- **Status panels float anywhere.** The joints, motion and program panels (open or folded to their header) are dragged anywhere in the window by their header, kept inside the window (re-clamped on resize), and each remembers its spot (`store/statusDock.js` `pos`, stacking `z`; arrow keys on the grip nudge it). A newly opened panel starts under the top bar, right-aligned beside the others, as before. They now render in a fixed layer (`layout/StatusDock.jsx`, z-index 720, above the floating IO chips and below menus and dialogs); the top-bar strip holds only the emergency and paused banners. Settings › Display › Status panels has "Reset positions". @dnd-kit is no longer used by the dock (still used by Motion Programs).
- **Teach Points:** the page toolbar is gone. Rosbridge and Source buttons removed; Tools (keyboard pendant, gamepad jog) sits next to the TCP speed in the Robot motion card; "Reload points" is the first entry of the points menu, before Manage access and Delete all.
- **Program chip:** reads Idle when the control process is on and nothing runs (ready, no program loaded, waiting for the runner), Running during a run, Stopped when the process is off.
- **Hidden paths:** runner messages ("tree loaded: …"), the last runner change, failure reasons and motion messages pass through `plainText` in `store/robot.js`, so the chip tooltip and panels show only names; the robot messages drawer too. The TCP badge tooltip no longer names the broadcaster.

## Round 12b: Validate with error nodes, runner Start chooser, event stepping (2026-10-14)

- **Validate shows the nodes.** `POST /robot/bt/runner/validate` takes `main: true` (the main program, `control_data/main_tree.xml`) and now returns `issues`: every error / warning of `control_logic_bt` `validate_tree` (text `file.xml:LINE Node 'name': …`) with the node it names, found by `ros/btIssues.js` from the file and line: `tree` + `idx` (the editor's subtree and child-index path) and `paths` (child-index paths in the running tree, every SubTree expanded, one per use). `POST /robot/bt/runner/load` takes `main: true` the same way.
- **Error card** (`components/robot/ValidationPopup.jsx`, `useValidation()`): small, dragged anywhere inside the window by its header (position kept in `nextup.validation.pos`), one problem at a time with Previous / Next, errors first; a Warnings box adds the warnings. Pages mark error nodes red and warnings amber and focus the current one.
- **Robot Program:** Validate button in the toolbar. Next / Previous switch to the subtree that holds the node, select it (its settings open) and centre it; the tree and ladder views both mark problems. Problems outside the editor's trees (IO trees) are listed with a note. Live view and Step mode in the run menu were tested in the simulator and kept; the run status there now follows the runner's state (it said "Running #0" while idle).
- **NexRoot Runner:** Start opens a chooser: cycles (5, 10, 50, 100, 1000, ∞ or a number) and mode (Normal, Dry, Sim), last choice remembered. The mode dropdown and the tree picker are gone; Load (always the main program) and Validate sit at the right of the bar. Validation marks nodes in the Compact and Graph views (a folded subtree holding a problem is marked too); the Data tab no longer lists validation text. Events tab: Previous / Next select the row above / below and show its node, like a click.
- **Simulator:** `simBtRunner.validateTree` now checks like the real validator (includes, BehaviorTree IDs, SubTree IDs, decorator / control child counts, number ports, point names against points.yaml, unused subtrees, missing Start) and words its lines the same way. Real ROS path untested.

## Round 13: Diagnostics: IO watch window, full robot records, black-box viewer (2026-10-14)

Tested in the simulator with the record files from a real robot (the `error_container` of the
uploaded `user_config_files`).

- **Monitoring Start / Stop and "Open terminal on robot" removed** from Diagnostics, with their
  backend parts (`POST /error-logs/open-terminal`, the `MONITORING_START/STOP` WebSocket messages,
  `callMonitoringStart/Stop` in both bridges).
- **IO watch button** (Diagnostics toolbar) opens a floating window (`components/ui/FloatingWindow.jsx`:
  drag by the header, resize from any edge or corner, double-click the header to fill the screen;
  spot and size kept in `nextup.win.<id>`). Left: every input of drives 1-6 (`joint1..6`, DI1-DI8)
  and the GPIO module (outputs with the Outputs switch), named after the project's IO sequences.
  Tick to watch, untick to stop, edit the name, edges and debounce; **Apply** calls
  `set_io_watch` once per change. Right: the IO log with every field (time, signal, HIGH/LOW, how
  long the previous level held, count, pin and bit, mode, detail, robot position at the change),
  live edges merged in, a HIGH/LOW timeline per signal (last 1 min / 5 min / hour), filters and
  Trace 60 s. When `get_io_watch` is missing the list is read from `io_watch.yaml` (read only).
- **Robot records show every field.** `ros/recordFiles.js` reads `event_logs.yaml`,
  `error_logs.yaml`, `io_logs.yaml` and `motion_logs.yaml` straight from `error_container` (the
  services drop fields such as `request_id`, `result`, `cause`, `file`, `last_error`,
  `previous_error`); the service is the fallback (`?from=service` forces it). Known fields are
  columns; anything else shows as chips in Details; a click on a row lists the whole record.
  Drive errors: Last error (hex, decimal, text from `error_codes.yaml`, lookup button), Previous
  error, drive state + statusword + mode. Supervisor events: mode / phase, request and result,
  cause, a View recording button on `blackbox_saved`. Motion log: result, error code, speed,
  acceleration, scale, duration. Event / joint filters and a Last 100/300/1000 choice.
- **Black-box viewer** (View on a recording or on a `blackbox_saved` event). Chart: a panel per
  group (position, velocity, position command / out, jog command / out) with a J1-J6 picker,
  degrees or radians, lanes for the supervisor phase / profile / drive mode / armed / latched /
  estop, the drive statusword (decoded to the CiA 402 state) and mode per joint; trigger line at
  t = 0, drag to zoom, click for the cursor, readout of every value and min / max in view, and a
  list of every change (click to jump). Table: column groups and joints, "only rows that change",
  go to time, double-click a cell to edit, tick rows (Shift for a range) to remove; Undo, Reset,
  download the CSV, or **Save copy** next to the original (`<name>_edited.csv`, the original is
  never changed; only edited copies can be deleted). Cause and trigger time come from the file's
  header (the old name parser missed causes ending in `joint5` and showed "emergency").
- **Simulator:** starts with the real record files (`backend/config/sim_records/`, copied into
  `user_config/sim/error_container` on first start), writes its own events, errors, IO edges and
  black boxes in the real formats, and saves `io_watch.yaml`. IO page Signal watch now offers
  `joint1..6` like the service expects (it offered `driver1..6`).

## Round 14b: Robot Program editor (2026-10-15)

- **Unique node names.** New nodes are named `<Type>_<HHMMSS><2 digits>` (hundredths of a
  second, zero-padded time), checked against the names in the open subtree; duplicate and paste
  use the same stamp in `freshClone`. Quick-adding the same node several times in one second no
  longer gives equal names.
- **One-step undo.** Ctrl+Z undoes the last change made in the editor (add, delete, move, wrap,
  paste, duplicate, settings, add/delete subtree); Ctrl+Y or Ctrl+Shift+Z redoes it. Undo and
  redo buttons sit next to the subtree name. `backend/service/treeUndo.js` keeps the editor file's
  text before and after the last edit (in memory, one step) via a middleware on the editing
  routes; it refuses to undo when the file changed since (project switch, another page).
  Routes: `GET /main-tree/undoState`, `POST /main-tree/undo`, `POST /main-tree/redo`.
- **Run path subtrees removed** from the library, insert dialog, preview, source view and the
  backend (`/getRunPathSubtrees`, `/getRunPathSubtree/:id`, `/addRunPathSubtreeAsChild`).
  New projects still get an empty `run_path.xml` (the template's include is unchanged).
- **Motion programs in the library.** The section lists the programs of the Motion Programs page;
  + opens "Add a motion program": program, node name, repeat, speed, acceleration and the
  palletizing offsets, with a preview, and adds `<RunProgram program="…" …/>` inside the selected
  container (or after the selected node). `RunProgram` is added to the node library when
  `nodes.json` lacks it (treeModel `BUILTIN_NODES`, ports from motion_server_pkg), so the node
  editor offers every port with its default and a program picker; Quick add of RunProgram opens
  the same dialog.

## Round 14a: Bundled config and small UI fixes (2026-10-15)

- **No nextupWeb folder any more.** `backend/config/roots.js` resolves every folder: the app's
  own config is `backend/user_config` (found from the code's location, so the app folder can be
  unpacked anywhere and renamed), and the only outside folders are the robot's
  `user_config_files` and `active_project_configs`. Defaults stay `/home/nextup/...`; override
  with `NEXTUP_HOME` (both), `NEXTUP_USER_CONFIG_FILES`, `NEXTUP_ACTIVE_PROJECT` or `NEXTUP_WS`.
  `config/path.js`, `utils/pm_utils/paths.js`, project creation (template + `pm_defaults`),
  faults.json, the servo frame file, robot routes and the tree UID cache all use it.
- **Autosave fixed.** The startup error (`ENOENT ... nextupWeb/user_config/pm_templates/
  default_project_template.json`) stopped the change watcher, so the project never became
  "unsaved" and autosave never ran. The template now ships in `backend/user_config/pm_templates`.
  Tested with the real user_config_files / active_project_configs: an edit marks the project
  dirty and the autosave call saves a new version.
- Shipped settings from the uploaded user_config: `frame.json`, IO layouts, `user_settings.json`
  (counters reset). `pm_defaults` keep this app's newer versions (programs.yaml, MsgLogger names).
  Backend package renamed `nextup-react-backend`.
- **Move dialogs close at 100 %.** Move to a point and Go to a target close themselves when the
  motion succeeds (Test runs and failures stay open to read). `lib/useCloseWhenMoved.js`.
- **Client Control:** the 3 s start countdown is gone. Big buttons are **Start**, **Stop** and
  **Finish Cycle**. Finish Cycle sends `/control_exit_bt`, which control_logic_bt treats as
  "finish the cycle, then stop" (the old EXIT button did the same); the small "Finish this cycle"
  link was removed (it sent `/control_stop_bt`, a plain stop).
- **Themed tooltips.** `lib/themedTooltips.js` (installed in boot.jsx) shows every `title` as a
  translucent card in the theme colour instead of the browser's own tooltip (black in Qt
  WebEngine). Titles move to `data-nx-tip` as they appear; icon-only buttons keep the text as
  `aria-label`. Style `.nx-tip` in `styles/components.css`. Keep using `title=` in new code.

## Round 15: Tutorials (v1.0-dev, 2026-10-19)

The graduation-cap button next to the theme (palette) button in the sidebar opens **Tutorials**:
hands-on lessons for Projects, Teach Points, IO Control and Robot Program (Motion Programs is not
covered yet). Lessons drive the real page, like a game tutorial: the control to use is lit up with
a ring and a pointing hand, the rest of the page is dimmed, and the step finishes when the person
does the action. Each step gets a short cheer, each lesson ends with a trophy, stars, confetti and
a "Next lesson" button. Every card can be closed, skipped or stepped back, and nothing over the
page takes the mouse (the overlay is `pointer-events: none`), so the UI is never locked.

- **Code:** `frontend/src/tutorial/`. `engine.js` (zustand store, step runner, key/click/signal
  listeners), `TutorialHost.jsx` (spotlight, card, cheers, finale), `TutorialMenu.jsx` (lesson
  picker with progress), `bus.js` (signals), `bridge.js` (page state), `lessons/*.js`.
- **How a step finishes:** `click` on its target, a `signal` (every successful API call sends
  `api:METHOD /path`, WebSocket sends `ws:TYPE`, jog buttons send `jog`), a `check(ctx)` that
  becomes true, a `press` of a key combo, or a Next button for info steps. `keys` makes a step
  count only when its shortcut was used; `requires`/`backTo` go back a step when the page leaves
  the needed state (menu closed); steps in the same `group` accept any route to the same result.
  Nothing polls while no lesson is open; during a lesson the spotlight is measured every 200 ms.
- **Targets** are `data-tut="…"` attributes on real controls (or a CSS selector, a list, or a
  function). A confirm dialog's OK button (`data-tut="confirm-ok"`) takes the light by itself.
  Hidden targets are scrolled into view; a hidden tree node is centred on the canvas.
- **Robot moves:** steps marked `motion` first show a warning and light up the E-STOP until the
  person presses "I'm ready". Joint jog, Cartesian jog, Update a point, Go to a point and Switch an
  output use it.
- **Robot Program lessons** run in their own subtree, `Practice_tutorial` (made when needed, with a
  RootSequence). The menu has "Fresh practice area" and "Remove practice area"; the real program
  is never touched. Editing lessons are done first with the mouse, then with the shortcut.
- **Node lessons come from the node library:** `lessons/nodeCatalog.js` groups nodes that behave
  alike (Always Success/Failure, sequences, fallbacks, decorators, timing, IO, moves …) with one
  short line each; `lessons/treeNodes.js` builds a lesson per group from the nodes the library
  really has, and a "More … nodes" lesson per category for nodes the catalog does not know.
  Settings lists come from each node's ports.
- **Progress** is kept in `nextup.tutorials.done` / `nextup.tutorials.seen` (saved with the other
  UI preferences). "Reset progress" clears a page.
- **Adding a lesson:** add `data-tut` ids to the controls, then an object to the page's lessons
  file: `{ id, page, group, icon, title, blurb, learn, setup?, motion?, steps: (ctx) => [...] }`.
  Page state a lesson needs goes through `useBridge(name, value)` in the page.

## Round 16: NextPLC page and "reached the controller" DO dots (2026-10-20)

**NextPLC** (sidebar, Programming, route `/nextplc`) brings the nextplc console into the app as
native pages: **Program | Block Library | Monitor | Help** (`/nextplc/program` …). The old
Simulate page is gone (Monitor + the simulated PLC cover it) and Commissioning is part of Monitor.

- **Code:** frontend `frontend/src/pages/nextplc/` (the console's pages, ported; `NextPlcPage.jsx`
  is the shell, `store/plc.js` the live store on the app's WebSocket, `lib/prefs.js` page settings
  under `nextup.plc.*`). Backend `backend/plc/` (routes under `/plc-api`, the simulated and the
  robot PLC bridges, the JS engine in `backend/plc/engine/`, also bundled into the frontend through
  the Vite alias `nextplc-engine`).
- **Status strip:** only what the top bar does not show: RUN/STOP + program, SAFE / IO fault /
  FORCE when on, and SIM | ROBOT (which PLC the pages talk to; ROBOT asks first and is offered only
  with the real robot). Robot mode, emergency, connection and the rail/theme menu of the old
  console are dropped. Scan period / time / count are on the Monitor page.
- **Where the files are:**
  - project (`active_project_configs/plc_data`, saved and versioned with the project, autosave
    included): the programs, `scenarios/`. A project without programs gets the robot folder's
    programs once, else the package examples (marker `.nextplc_seeded`).
  - robot (`user_config_files/plc`, what nextplc_node reads): `program.yaml` (startup program;
    "Set as startup" copies a project program there and keeps a dated backup), `retain.yaml`
    (never written by the app), `blocks/` (your own blocks).
  - app (`backend/user_config/nextplc`): sim/robot choice, simulator retain, `package/` = bundled
    copy of the package's blocks, manuals and examples, used when the package is not installed.
- **Panes** use `Split` (`plc.program`, `plc.library`, `plc.block`, `plc.monitor`, `plc.help`):
  drag to resize, double-click to reset; "Hide code", "Hide image / panel" and the list toggles
  remove a pane and the other takes the whole width. Below 1100 px they stack and the page scrolls.
- **Monitor** = live image + side panel (Commission | Rungs | Sequences | Alarms | Events).
  Clicking an M bit, a register, an input or an output fills the matching Commission field; in
  the simulator a click on an input toggles it.
- **Help:** the manuals without the old sentence format (removed on the server, whole sections and
  single lines), a search over every section of every manual (Enter opens the best hit, the words
  are highlighted in the text), the list/contents pane can be hidden, and **Reading | Cozy** at
  the top right (`nextup.plc.helpStyle`).
- **CPU:** the 50 Hz PLC state is subscribed (robot) / sent (both) only while a NextPLC page is
  open (`PLC_WATCH` from the page; dropped when the socket closes).
- **Styles:** `nextplc.css` is generated from the console's CSS with every rule under `.nxplc`
  (so `.btn`, `.tabs`, `.page` … of the rest of the app are untouched); NextUp-specific changes go
  in `nextplc-extra.css`.
- **DO dots (IO Control, pinned chips):** the new controllers publish the commands they accepted
  (`/nextup_digital_output_controller/applied_commands`, `/nextup_gpio_command_controller/applied_commands`).
  The dot next to each output switch now says whether the command reached the controller: green ON,
  grey OFF, amber pulsing = sent and waiting, red = not accepted within 1.5 s. The switch itself is
  unchanged. Older installs without those topics keep the previous feedback dot. In the simulator
  `POST /robot/sim/dorefuse` toggles refusing every command (to see the red dot).

## Round 17: config cleanup, NextPLC library, manual-save versions, more tutorials (2026-10-20)

- **Folders.** `active_project_configs` is now `<home>/active_project_configs` (home of the user
  running the app; `NEXTUP_HOME` / `NEXTUP_ACTIVE_PROJECT` override). Full layout, removed files
  and the ROS packages that still read the old place: [ROBOT_PATHS.md](ROBOT_PATHS.md).
- **Removed with their code:** visualizer password file and endpoint; `monitor.yaml` with
  `/ros-monitor/names`, the start-up "waiting for nodes" screen and the Diagnostics ROS monitor
  tab; `mapped_data.yaml` and its routes; per project the emergency manager / velocity tuner /
  dashboard copies, paths and plan path files, run path trees (and the template include),
  `control_data/nodes.json`, `debuggers/`. `utils/pm_utils/layoutCleanup.js` cleans old projects
  at start-up and on load / restore.
- **NextPLC files.** A project's `plc_data` holds only `program.yaml` (this project's program,
  what the PLC runs; API name `@project`) and `retain.yaml`. Every other program, the scenarios,
  your blocks and replaced programs are in `user_config_files/plc` (programs/, scenarios/,
  blocks/, backups/), shared by every project. Program tab: "This project's program" first,
  then the library; "Use in this project" replaced "Set as startup"; "Save as" keeps a copy in
  the library. Old layouts are migrated by `plc/paths.js`. The app loads the project program into
  the PLC when a project is loaded or restored.
- **Versions.** Autosave saves the project without a version or backup; only Save from the UI
  makes a version (a copy of the saved state). Versions can be deleted one by one or all at once
  (`DELETE /api/projects/versions/:name[/:id]`); they move with a rename and go with a delete.
- **Program editor fix.** The coloured text layer clipped itself at the editor height, so after
  scrolling the text below the first screen vanished (only a selection showed it).
- **Help.** The simulator manual and the simulator part of the full manual are gone; the
  sentence lines are shown again.
- **Tutorials** for Motion Programs, NextPLC (all four tabs), NexRoot Runner, Client Control,
  Diagnostics and Settings (`tutorial/lessons/*.js`); project lessons cover version delete.

## Round 18: complete page loads, safety interlock, single DO topics, sturdier PLC switch (2026-10-22)

- **Every page loads complete.** Why pages came up partly empty: a read (points, programs, PLC
  status, robot models, meshes…) that failed once while the robot server was starting or busy
  stayed failed (one retry, or none for hand-written loaders), and a page's code that failed to
  download was not fetched again. Now every read (GET) is tried again on a network error or a
  5xx (0.4, 0.8, 1.6, 3.2 s: `lib/retry.js`, used by `api.js`, the NextPLC client, the 3D model
  and mesh loaders); data a page shows as failed is read again when the server is back (socket
  reopen); page code is fetched with retries, and 3 s after start the code of every page is
  downloaded in the background (`page-chunks.json` from the build, `lib/preload.js`), so opening a
  page later needs no download. The app's own start code retries too. Tested by failing every
  read and code file twice: all pages came up complete. Safety net: if a page still has not come
  up after 10 s, a notice offers **Reload page**; code the browser could not fetch at all makes
  the web app reload itself at once, as soon as the server answers (at most twice in two
  minutes). Alt+R reloads the current page, Alt+Shift+R the web app; Settings › System ›
  **Reload web app**.
- **Safety interlock.** While the robot program runs or is paused mid-cycle (runner state
  RUNNING/PAUSING/PAUSED/STOPPING/FINISHING/STEPPING or the old control-active flag) or a motion
  is under way, these are refused with a "Stop the robot first" popup and nothing changes:
  points (teach, edit, delete, reorder, undo), motion programs (save, order, delete, text),
  homes, tool offset, overspeed limits, planner / motion type, project load / discard / restore
  / renaming the active project, switching NextPLC to the robot's PLC and loading a program into
  the robot's PLC (loading into the simulated PLC stays free). The browser checks first
  (`lib/interlock.js`, every request through `api.js`), the server checks again
  (`utils/interlock.js`, `409 ROBOT_BUSY`, `GET /system/interlock`). Loading a project while the
  robot's PLC runs a program asks first (that project's PLC program is loaded at once).
- **Digital outputs.** The per-joint topics `/nextup_digital_output_controller_<n>/commands` are
  gone. Joint outputs are sent on `/nextup_digital_output_controller/commands`
  (NextupDigitalOutputsCommand, `name: [jointN]`, one field set), GPIO on
  `/nextup_gpio_command_controller/commands`. The switches follow the commands topics; the
  status dots follow only `/nextup_digital_output_controller/applied_commands` and
  `/nextup_gpio_command_controller/applied_commands` (no fallback to the command echo).
- **Robot server keeps running.** An exception in a callback no longer stops the server: it is
  logged and the browsers get one warning toast (at most every 10 s). Only a taken port still
  stops it. The robot's PLC: callbacks are guarded, the switch to Robot needs the PLC on the
  robot to answer first, and if the console stopped while connecting, the next start uses the
  simulated PLC instead of failing again (`<nextplc state>/mode.json.connecting`).
- **Browser side.** Repeated toasts collapse into one with a count; when the server is
  unreachable data queries pause and retry with growing delays (1 s … 15 s) and resume when the
  socket is back; commands are never queued and sent late.
- **Colours.** NextPLC's ROBOT button uses the theme accent instead of red, and "Load into
  ROBOT" is a normal primary button (red stays for danger).
- **Teach Points jog panel** sizes itself from its own width (container queries): labels, values
  and the frame picker stay visible at any width, Joints and Cartesian sit side by side when
  wide, the panel stops at 640 px (detached 3D view: 320 to 600 px column).

## Round 19: every PLC logic as ladder, Client Control operator panel (2026-10-22)

**NextPLC Ladder tab.** Function blocks and alarms are ladder rungs now, like the program's own rungs
(`pages/nextplc/components/ladder/FbRungSvg.jsx`, used by `LadderEditor.jsx`):
- A block instance (`blocks:`) is a function-block box: every bit input enters from the left through a
  contact on the address it is wired to, parameters (time, number, register) enter as value tags, every bit
  output leaves on the right into a coil on its address. Port kinds come from the block library
  (`GET /plc-api/blocks`). Live: contacts close, coils light, the box turns green while an output is on.
  Click the rung: an inspector edits the instance name and every port (with the address picker);
  "Change block…" opens the block wizard. Duplicate, move, delete and "line" as for rungs; **Block** in the
  palette adds one.
- An alarm (`alarms:`) is a rung with a contact on the alarm bit driving an ALARM coil that shows the level
  and the text (red / amber / blue by level, blinking while active). Inspector: bit, text, level, popup.
  **Alarm** in the palette adds one (kept as a draft until it has a bit).
- Everything is written into its own row of the YAML, so the code, Form and Ladder stay in sync.

**Client Control.**
- The control deck is one compact card: state + process, smaller Start / Stop / Finish Cycle buttons,
  a small speed-override gauge with its slider, and the production figures (this session, last session,
  total, last cycle, avg 5, avg 15, cycle-time chart) as its bottom row (`ProductionStrip.jsx`).
- Setup, Inputs and Outputs are gone; in their place is the **operator panel** (`pages/client/panel/`):
  a 12-column grid of widgets. **Edit** → **Add** shows the palette: button, toggle, indicator, option
  buttons, dropdown, number field, slider, text field, value display, signal group, heading. Each widget is
  wired to one of: a console action (start / stop / finish / pause / resume / load the robot program,
  process on / off, mode AUTO / SAFEAUTO / JOG, reset emergency, E-stop, stop motion, go home, run a motion
  program, finish / reset motion, start the PLC (= load its program), reset PLC fault, release forces,
  reset total counter, reload the web app), a PLC bit or register (M bits and R registers are written;
  inputs, outputs and S bits are shown), a robot input / output (joint1..6 / gpio1, pin), a signal of the
  IO list, a ROS topic (Bool, Int32, Int64, Float64, String: shown and published), a behaviour-tree
  blackboard entry (shown only: the runner has no service to write it), a robot state (emergency, moving,
  program running, process, at home, mode, speed override, cycle counters) or the run mode / CNC setting.
  Buttons pulse, hold, toggle, set or reset a bit, or send a value. Groups show many inputs as lamps or many
  outputs as switches, either chosen signals or the whole IO list.
- In edit mode widgets drag by their body and resize by the corner, snapped to the grid; what they cover
  moves down and gaps close upwards. **Auto-arrange** packs them in reading order and widens them into free
  cells so rows end on one edge. Colours: auto, accent, green, red, amber, blue, gray (theme tokens).
  Narrow screens stack the widgets in one column.
- **Safety:** every widget that acts is refused with the "Stop the robot first" popup while the program runs
  or the robot moves (same interlock as round 18), unless that widget's "Only when the robot is stopped" is
  unticked. Stop / reset kinds (stop program, finish cycle, pause, process off, reset emergency, E-stop,
  stop motion, PLC reset / release, switching something off) always work. "Ask before it acts" adds a
  confirmation (on by default for AUTO, go home, run program, load program, start PLC, reset counter, reload).
  Topic publishing with the interlock on is checked again on the server (409 ROBOT_BUSY).
- **Saved per project:** `control_data/operator_panel.json` in the active project (backend
  `panel/panelService.js`, `GET / PUT / DELETE /operator-panel`), so it is autosaved, versioned and restored
  with the project. No file = the default panel: Run mode (with the speed scale for High speed test), CNC
  machine, Reset emergency, Stop motion, Inputs (whole IO list) and Outputs (whole IO list). That is where
  the old run mode / CNC selection and IO lists live now; **Default** in edit mode brings them back.
- Topics: `GET /operator-panel/topics` lists std_msgs topics; WS `PANEL_WATCH { topics }` subscribes only
  to the topics the open panel shows (shared, dropped when no page shows them), values come as
  `PANEL_TOPIC { name, value }` at most 5 per second; `POST /operator-panel/publish`. The simulator keeps
  topics in memory with demo topics `/cell/door_closed` (toggles every 5 s), `/cell/part_count`,
  `/cell/status_text`, `/cell/lamp`, `/cell/recipe`, `/cell/feed_rate`. Topic names appear only in the
  widget settings (edit mode), never on the operator view.
- The PLC has no stop service: "Start PLC" loads the project program; a PLC without a program holds its
  safe state.
- Tutorials: the Client Control tour and the IO / run-mode lessons point at the panel; new lesson
  "Build the operator panel".

## Round 20: jog pad, PLC marks on IO, diagnostics summary, bit picker, more themes (2026-10-23)

- **Jog pad** (Teach Points › Robot motion › Tools): the keyboard pendant and the gamepad jog are one
  floating window (`pages/points/JogPadWindow.jsx`, generic `FloatingWindow`, box remembered as
  `nextup.win.jogpad`) with a Keyboard | Gamepad switch in its header, so only one is ever open. No
  backdrop: the 3D view stays visible for practice in sim. It moves the robot **only while the window has
  focus** (green border, "In control"); a click on the page or the 3D view lets go and stops the jog.
  `KeyboardPendant.jsx` / `GamepadJog.jsx` replace the old modals. The gamepad shows a drawn controller
  (`GamepadGraphic.jsx`, inline SVG, theme tokens) that lights every held button, moves the stick knobs and
  marks the active dead-man trigger, plus a guide table (control → joint / Cartesian axis and direction) with
  the moving row highlighted; the keyboard table highlights the held key's row too. The pendant only takes
  over Shift/Alt+letter keys while it has focus (Alt+R reload works again when it does not).
- **Planner switch removed** (Robot motion panel and its tutorial step). Motions use the motion server's
  own default planner (`goto/get_config default_planner`; PILZ when the config does not say). The backend
  routes `/ros/plannerState` and `/ros/togglePlanner` stay for scripts.
- **"Used by PLC" marks**: `GET /plc-api/plc/io-usage` (`backend/plc/ioUsage.js`) walks the running program
  (simulator's loaded program, else the file the robot's PLC reports, else this project's program) and lists
  every DI / DO it uses in rungs, sequences, alarms and blocks, with its PLC name and where it is used. An
  output the program writes is "driven". IO Control draws a blue ring + PLC tag on read signals and an amber
  ring on driven outputs (manual changes get overwritten on the next scan) in Driver I/O, GPIO I/O, the IO
  list and pinned floating controls; the tooltip says where. Operator panel IO widgets get the same PLC tag.
  Frontend `lib/plcIoUsage.js` (refreshed on PLC_PROGRAM and every 30 s).
- **Black box table**: fixed column widths; a long cause wraps up to 3 lines with the full text on hover;
  cause filter chips group by the text before " - " and truncate.
- **Diagnostics › Summary** (new tab between Logs and Robot records, `SummaryPanel.jsx` + `summaryData.js`):
  "Get latest summary" reads every source once (robot state, supervisor events, drive errors, fault counters,
  motion log, black box, PLC, uptime, connection, project) and shows a verdict (all good / needs attention /
  action needed) with findings sorted by severity, then Robot now, Last 24 hours (counts + last emergency,
  fault, refused request, failed motion, recording with View), PLC, Joints (state, counters, last error code
  linked to Fault lookup) and Robot PC. **Copy** puts it on the clipboard as text for service. New lesson
  "Get the summary".
- **Logo**: a double click / double tap on the NextUp logo reloads the web app (like Settings › System).
- **Operator panel settings**: PLC address, topic and blackboard fields are a searchable combobox
  (`components/ui/Combobox.jsx`): type to filter, arrows + Enter, at most 40 shown, grouped (program names
  with their address first, memory bits, registers, inputs, outputs, system bits with help), any typed text
  allowed. Heading widgets have **Text size** (small / medium / large / extra large) and CAPITALS / Normal.
- **Themes**: 8 more accents (Navy, Denim, Plum, Pink, Mocha, Olive, Spruce, Aubergine; 16 in all), chosen
  clear of the safety colours; every one passes the contrast checks of `scripts/gen-themes.mjs`.

## Round 21: NextPLC CPU (2026-10-24)

`node server.js` went from under 20 % to 90 %+ in kiosk mode on the robot once NextPLC was in. The cause
was the live PLC image: while a NextPLC page or an operator panel with a PLC widget was open (Client
Control in a kiosk = always), `/nextplc/state` (published at 50 Hz, ~300 bit/register names per message)
was decoded by rclnodejs on **every** message and pushed to the browser 10 times a second even when
nothing changed.

Backend
- `plc/PlcBridge.js`: `/nextplc/state` goes through `ros.subscribeState` (raw bytes, newest message
  read at most every 200 ms = 5 Hz; a cheap per-message hook keeps the "last data" age). Unsubscribed
  as soon as no page watches. `LightweightROSBridge.subscribeState` gained `onMessage`, `decode` and
  `gate.destroy()`.
- `plc/plcStateCdr.js` (new): reads the raw PlcState bytes directly (0.16 ms instead of 16-25 ms per message
  through rclnodejs; output checked identical on 100 messages). If it ever throws, the rclnodejs decode is
  used instead.
- `plc/statePush.js` (new, both bridges): PLC_STATE only when bits, registers, steps, rung results or
  forces changed; a frame where only the scan counters moved goes out at most once a second.
- `plc/SimPlcBridge.js`: image built only for a watching page, 5 Hz; per-scan retain check compares numbers
  instead of building a string every 10 ms.
- `panel/panelService.js`: operator-panel topics are raw subscriptions decoded at 5 Hz, sent only on change.
- `plc/ioUsage.js`: cached per program (sim: the loaded program object; robot: file path + mtime).

Frontend
- `lib/liveRate.js` (new): `subscribeLimited(type, ms, fn, merge)` draws at most every `ms` and nothing
  while the tab is hidden (newest value drawn when it shows). Used for PLC_STATE (4 Hz), PANEL_TOPIC
  (merged per topic, 4 Hz) and DO_APPLIED reach dots (4 Hz).
- A hidden tab sends PLC_WATCH off / an empty PANEL_WATCH, so the server stops decoding too.
- PLC store keeps `state` unchanged when only the scan counters moved (`scan` holds them; the Monitor's
  scan box reads it). Monitor bit cells are memoised; the Program page subscribes to rung/step strings only.
- Endless smooth CSS animations repainted 60 times a second (~20 % browser CPU each without a GPU):
  tutorial button dot and Client Control "breathe" now run 3 times; status blinks (bad lamp, running step,
  live dot, alarm) use `steps(2)`. Colour transitions on live PLC cells and panel lamps removed.
- IO "used by PLC" marks refetch every 2 min (plus on program change) instead of 30 s.

Measured (this container, 4 cores; ROS 2 Jazzy + rclnodejs 1.8 with the real nextplc messages, a publisher
sending `/nextplc/state` at 50 Hz like nextplc_node, one PlcBridge watching):

| | before | after |
|---|---|---|
| backend CPU, live PLC watched | 134-139 % | 6 % |
| PLC_STATE frames to the browser | 9.2 /s, 43 KB/s | ≤ 5 /s, only on change (3 /s, 14 KB/s with blinking bits) |
| browser CPU, Dashboard (sim, no GPU) | 24 % | 2 % |
| browser CPU, Client Control | 27 % | 4 % |
| browser CPU, IO Control | 28 % | 2 % |
| browser CPU, NextPLC Program | 28 % | 4.5 % |
| browser CPU, NextPLC Monitor | 51-53 % | 9-10 % |

The rest of the sim server (simulated robot + simulated PLC) stays at ~3 % either way.

## Round 22: drive tools (EtherCAT config) and whole-console software update (2026-10-26)

The separate EtherCAT config tool (ethercat_config_tool_react) is now part of the console. One server,
one ROS node, one version.

Where things are
- **Settings > Driver Settings** (below Robot / Point teach / Display / System): three tabs, Recipes,
  Drive settings and Manual read/write (`/setup/driver-settings/{recipes,drive-settings,manual}`). The drive
  status strip (simulated/real drives, Drive comms switch, ready count) sits on the right of the tabs.
- **Settings > Software Update** (directly below Driver Settings): updates the **whole** console, not only
  the drive tools.
- **Diagnostics > Robot records > Drive faults** (next to Black box): the tool's Faults page.

Backend
- `backend/ethercat/` (CommonJS, own `package.json` with `"type":"commonjs"`, like `backend/plc/`):
  the tool's server as a router mounted at **`/ecat-api`**. It uses NextUp's single rclnodejs node (no second
  `rclnodejs.init`); `ethercat_msgs` added to `ros/bindings.js`. Simulated drives (6) when the robot bridge
  is simulated; `ECAT_MOCK=1|0` forces it. Drive writes (SDO set, reset, homing, apply settings, run recipe,
  start/stop the EtherCAT node) are refused while the robot is busy (same "Stop the robot first" popup).
- `backend/update/` (CommonJS): software update router at **`/update-api`**, `launcher.js`, `update-worker.js`.
- Data: drive recipes, settings, history in `user_config_files/ethercat/`; update settings, history, reports
  and backups in `user_config_files/software_update/`. On the very first start the drive data is imported
  from an old `~/ethercat_config_tool*/user-data` folder if there is one (`ECAT_IMPORT_FROM=<dir>` to choose).

How the update works
1. Versions are git tags `v1.2.3` in the repository. Only tags the GitHub Action (`.github/workflows/release.yml`)
   passed can be installed: it adds `verified/v1.2.3` on the same commit (Update settings has a switch to allow unchecked tags).
2. Install: saves a copy of settings + drive data, checks out the tag (files the PC changed under
   `backend/user_config/`, `backend/config/layouts/`, `backend/config/sim_records/` are kept), `npm install`
   in backend and frontend, builds the screens into `frontend/dist-next`, then starts the new version on a
   spare port in simulation as a smoke test. Nothing replaces the running screens until it passes.
3. "Restart now": the console exits with code 75, the launcher starts it again, `dist-next` replaces `dist`.
4. If the new version stops within a minute, or the robot connection / drives are worse than before the
   update, the launcher puts the previous version back by itself. "Go back" in the page does the same by hand.

**`npm start` now runs `backend/update/launcher.js`** (from the app folder or from `backend/`), which supervises
`server.js`. `npm run dev` / `npm run sim` in backend still run `server.js` directly (no restart button).

Setting up the repository (once)
- Put this folder in a GitHub repository (app folder at the repository root or in a subfolder; both work).
- On each PC: Settings > Software Update > Update settings > repository address (or `UPDATE_REPO`), with a
  read token for a private repository. A folder that was unpacked from a zip becomes a git copy on the first check.
- Release: bump `version` in `package.json` and `release-notes.json`, push, tag `v<version>`, push the tag.
  The Action builds, runs the tests, adds `verified/v<version>` and (when `HUB_URL` is set) publishes the
  notes to the release hub, where the app id is **`nextup_react`** (`UPDATE_APP_ID` to change).

Settings: `ECAT_PASSWORD` (manual write unlock, update install/go back/restart; default `123`;
`UPDATE_PASSWORD` for the update only), `ECAT_MOCK`, `ECAT_DATA_DIR`, `UPDATE_DATA_DIR`, `UPDATE_REPO`,
`UPDATE_TAG_PREFIX`, `HUB_URL`, `NEXTUP_PORT` (default 3000), `ROS_SETUP`, `WORKSPACE_SETUP`, `ETHERCAT_BIN`.

Checked here: `npm test` (drive units + update tests), sim server with simulated drives (health, slaves,
node start, SDO read), and an end-to-end update from a local repository: 1.0.0 → check → install 1.0.1
(all 7 steps incl. smoke test) → restart → 1.0.1 running with new screens → go back → restart → 1.0.0.
Not checked here: real drives and the real `ethercat_manager` services.

Round 22 follow-ups (2026-10-26)
- Manual read/write no longer asks for a password (writes still ask "Write this value to the drive?" and are
  refused while the robot is busy).
- Software Update > "Update settings" opens only after the password (`POST /update-api/auth/verify`); Save
  reuses it.
- Recipes list: drag a recipe up or down to change the order (off while searching); the order is the order
  in `recipe.json` and is saved on drop.
