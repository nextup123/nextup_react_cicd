//backend - server.js

// first: screens built by a software update and recipes put back by "Go back" are in place
// before anything reads them
import "./update/boot.js";
import express from "express";
import http from "http";
import cors from "cors";
import fs from "fs";
import os from "os";
import yaml from "js-yaml";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { getROSNode } from "./ros/rosService.js";

import logRoutes from "./routes/misLogRoutes.js";
import pointPlanningBtRoutes from "./routes/pointPlanningBtRoutes.js";
import oiConrol from "./routes/ioRoutes.js";
import settingsRoute from "./routes/settings.js";
import cycleRoute from "./routes/cycle.js";
import errorLogsServiceRoutes from "./routes/errorLogsServiceRoutes.js";
import mainTreeRoutes from "./routes/mainTreeRoutes.js";
import projectRoutes from "./routes/pm_projects.js";
import statusRoutes from "./routes/pm_status.js";
import driverRoutes from "./routes/driverRoutes.js";
import { initializeRuntime } from "./utils/pm_utils/runTimeInitializer.js";
import rosRoutes from "./ros/rosRoutes.js";
import robotRoutes from "./ros/robotRoutes.js";
import uiPrefsRoutes from "./routes/uiPrefs.js";
import robotModelRoutes from "./robotModel/routes.js";
import plcRoutes, { plcPaths } from "./plc/routes.js";
import { startPlc, handlePlcMessage, getManager as getPlcManager } from "./plc/plcService.js";
import panelRoutes, { startPanel, handlePanelMessage } from "./panel/panelService.js";
import ecat from "./ethercat/index.js";
import appUpdate from "./update/index.js";

import WSServer from "./ws/wsServer.js";
import { createWSHandler } from "./ws/wsHandler.js";
import { createLogger } from './utils/logger.js';
import { ERROR_LOGS_PATH, LAYOUTS_DIR, XML_BASE_DIR, pointPlanningFilePath, robotModelPaths } from "./config/path.js";
import { isValidServiceName } from "./utils/server_utils.js";
import { busyReasons, guardRoutes, interlockStatus } from "./utils/interlock.js";



const log = createLogger();
const app = express();

// A failing callback (a ROS message that does not match the bindings, a PLC or a robot node
// that disappears mid-call) must never take the whole console down and leave the operator
// without a web page while the service restarts: log it, tell the browsers (at most every
// 10 s), keep serving.
let notifyServerError = () => {};
let lastServerNotice = 0;
function keepRunning(kind, err) {
  log.error({ err }, `${kind} (the server keeps running)`);
  if (Date.now() - lastServerNotice < 10_000) return;
  lastServerNotice = Date.now();
  try { notifyServerError(String(err?.message || err || "unknown error")); } catch { /* socket not ready */ }
}
process.on("uncaughtException", (err) => keepRunning("uncaught exception", err));
process.on("unhandledRejection", (err) => keepRunning("unhandled promise rejection", err));
// NEXTUP_PORT: the software update test-starts a new version on a spare port
const port = Number(process.env.NEXTUP_PORT) || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The React frontend build (frontend/dist). Set FRONTEND_DIST to override.
const FRONTEND_DIST =
  process.env.FRONTEND_DIST || path.resolve(__dirname, "../frontend/dist");
const HAS_FRONTEND = fs.existsSync(path.join(FRONTEND_DIST, "index.html"));

app.use(cors());
app.use(express.json({ limit: "5mb" }));
if (HAS_FRONTEND) app.use(express.static(FRONTEND_DIST, { index: "index.html" }));
// The old iframe pages stay reachable (for example /doDiWeb/) while the
// React app is rolled out; their index.html no longer owns "/".
app.use(express.static(path.join(__dirname, "public"), { index: HAS_FRONTEND ? false : "index.html" }));

// ================= SAFETY INTERLOCK =================
// Changes that would take effect inside a running cycle wait until the robot program is
// stopped and the robot stands still (409 ROBOT_BUSY, nothing changed). See utils/interlock.js.
app.get("/system/interlock", (req, res) => res.json(interlockStatus()));
app.use("/point-planning", guardRoutes("change the points", [
  ["POST", /^\/(addPoint|updatePoint|deletePoint|deleteAll|reorderPoints|undo|editedPoint)$/],
]));
app.use("/robot", guardRoutes("change this setting", [
  ["POST", /^\/(programs|programs\/order|programs\/create-file)$/],
  ["PUT", /^\/programs\/raw$/],
  ["DELETE", /^\/programs\/[^/]+$/],
  ["POST", /^\/(tcp-offset|speed-limits|homes\/teach|homes\/active|config\/homing|config\/goto)$/],
  ["DELETE", /^\/homes\/[^/]+$/],
]));
app.use("/ros", guardRoutes("change the planner", [["POST", /^\/(togglePlanner|setMotionType)$/]]));
app.use("/api/projects", guardRoutes("switch the project", [["POST", /^\/(load|overwrite|restore)$/]]));
// loading into the simulated PLC reaches nothing: only the robot's PLC (and switching to it) waits
const plcLoadGuard = guardRoutes("change the PLC program", [["POST", /^\/(programs\/load|plc\/load)$/]]);
const plcModeGuard = guardRoutes("switch to the robot's PLC", [["POST", /^\/system\/mode$/]]);
app.use("/plc-api", (req, res, next) => (req.body?.mode === "real" ? plcModeGuard(req, res, next) : next()));
app.use("/plc-api", (req, res, next) => (getPlcManager()?.mode === "real" ? plcLoadGuard(req, res, next) : next()));
// drive tools: anything written to the drives (values, recipes, fault reset, drive settings,
// starting or stopping drive communication)
app.use("/ecat-api", guardRoutes("write to the drives", [
  ["POST", /^\/(sdo\/set|reset|homing|homing\/batch|driver-config\/apply|recipes\/execute|node\/start|node\/stop)$/],
]));

// ================= ROUTES =================
app.use("/point-planning", pointPlanningBtRoutes);
app.use("/io-control", oiConrol);
app.use("/settings", settingsRoute);
app.use("/cycle", cycleRoute);
app.use("/error-logs", errorLogsServiceRoutes);
app.use("/main-tree", mainTreeRoutes);

app.use("/api/projects", projectRoutes);
app.use("/api/status", statusRoutes);
app.use("/ros", rosRoutes);
app.use("/robot", robotRoutes); // new controllers: supervisor, motion server, records
app.use("/driver", driverRoutes);
app.use("/ui-prefs", uiPrefsRoutes); // panel sizes and layout, shared by every browser
app.use("/robot-models", robotModelRoutes); // robot descriptions + meshes for the 3D view
app.use("/plc-api", plcRoutes); // NextPLC (soft PLC): programs, blocks, live image, manuals
app.use("/operator-panel", panelRoutes); // Client Control operator panel: layout per project, ROS topics
app.use("/ecat-api", ecat.router); // drive tools: recipes, drive settings, manual read/write, drive faults
app.use("/update-api", appUpdate.router); // software update of the whole console, problem reports

// ================= SYSTEM APIs =================
// Tells the UI whether it is talking to the real robot or the simulation.
app.get("/system/bridge", (req, res) => {
  const ros = getROSNode();
  res.json({
    simulated: Boolean(ros?.simulated),
    ready: Boolean(ros?.initialized),
    bindings: ros?.bindings?.status ?? null,
    bindingsMessage: ros?.bindings?.message ?? '',
    missingTypes: ros?.missingTypes ?? [],
  });
});

// Where the robot's files live: shown only in Settings › System (the rest of
// the UI never shows file names or paths).
app.get("/system/paths", (req, res) => {
  const ros = getROSNode();
  res.json({
    simulated: Boolean(ros?.simulated),
    paths: [
      { label: "Active project data", path: path.dirname(path.dirname(pointPlanningFilePath.POINTS_YAML_FILE)) },
      { label: "Points", path: pointPlanningFilePath.POINTS_YAML_FILE },
      { label: "Programs and IO trees", path: XML_BASE_DIR },
      { label: "Error log", path: ERROR_LOGS_PATH },
      { label: "Tree layouts", path: LAYOUTS_DIR },
      robotModelPaths?.URDF_DIR ? { label: "Robot models", path: robotModelPaths.URDF_DIR } : null,
      ...plcPaths(),
      ...ecat.paths(),
      ...appUpdate.paths(),
      { label: "UI preferences", path: path.join(__dirname, "user_config", "ui_prefs.json") },
      { label: "Web console", path: __dirname },
    ].filter(Boolean),
  });
});

// In-process (the old version spawned the `uptime` command on every poll).
app.get("/uptime", (req, res) => {
  const secs = Math.floor(os.uptime());
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const hm = `${h}:${String(m).padStart(2, "0")}`;
  res.json({
    currentTime: new Date().toTimeString().slice(0, 8),
    uptime: d > 0 ? `${d} day${d === 1 ? "" : "s"}, ${hm}` : hm,
    loadAverage: os.loadavg().map((v) => v.toFixed(2)).join(", "),
    // Numbers for the UI rest alerts (12 h / 24 h uptime, load 8 / 16).
    uptimeSeconds: secs,
    load: os.loadavg().map((v) => Math.round(v * 100) / 100),
  });
});



app.post("/start/:service", (req, res) => {
  const service = req.params.service;
  if (!isValidServiceName(service)) return res.sendStatus(400);

  exec(`sudo systemctl start ${service}`, (error, stdout, stderr) => {
    if (error) return res.status(500).send(stderr);
    res.send(`Started ${service}`);
  });
});

app.post("/stop/:service", (req, res) => {
  const service = req.params.service;
  if (!isValidServiceName(service)) return res.sendStatus(400);

  exec(`sudo systemctl stop ${service}`, (error, stdout, stderr) => {
    if (error) return res.status(500).send(stderr);
    res.send(`Stopped ${service}`);
  });
});

// ================= POWER =================
app.post("/shutdown", (req, res) => {
  exec("sudo shutdown now", () => res.sendStatus(200));
});

app.post("/reboot", (req, res) => {
  exec("sudo reboot", () => res.sendStatus(200));
});

app.post("/force-shutdown", (req, res) => {
  exec("sudo poweroff -f", () => res.sendStatus(200));
});

// ================= REACT APP FALLBACK =================
// Client-side routes (/points, /paths, ...) all serve the React index.html.
if (HAS_FRONTEND) {
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (!(req.headers.accept || "").includes("text/html") || path.extname(req.path)) return next();
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

// ================= Shutdown ===================
function setupGracefulShutdown({ server, wsServer, ros }) {
  const shutdown = async (signal, exitCode = 0) => {
    log.info(`⚠️ Received ${signal}. Shutting down...`);

    try {
      // HTTP
      server.close(() => {
        log.info(`HTTP server closed`);

      });

      // WS
      if (wsServer && wsServer.close) {
        wsServer.close();
        log.info(`WebSocket server closed`);

      }

      getPlcManager()?.shutdown();
      ecat.shutdown();

      // ROS
      if (ros && ros.shutdown) {
        await ros.shutdown();
        log.info(`WebSocket server closed`);

      }

      setTimeout(() => {
        log.info(`Force exiting...`);

        process.exit(exitCode);
      }, 500);

    } catch (err) {
      log.info({
        err
      },
        'Shutdown error'
      );

      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Settings > Software Update > Restart now: `npm start` (update/launcher.js) starts it again
  return () => shutdown("restart", appUpdate.RESTART_EXIT_CODE);
}
// ================= MAIN START =================
async function startServer() {
  // ✅ CREATE HTTP SERVER (REQUIRED)
  const server = http.createServer(app);

  // ✅ PASS CORRECT OBJECT
  const wsServer = new WSServer(server);
  notifyServerError = (text) => wsServer.broadcast({ type: "SERVER_NOTICE", payload: { level: "error", text, at: Date.now() } });

  // ROS INIT - Use the async factory function
  const createROSNode = (await import('./ros/rosService.js')).default;
  const ros = await createROSNode(wsServer);

  // WS HANDLER
  const handler = createWSHandler({ ros, wsServer });
  wsServer.setMessageHandler((msg, ws) => {
    if (handlePlcMessage(msg, ws)) return;
    if (handlePanelMessage(msg, ws)) return;
    return handler(msg, ws);
  });

  // NextPLC: simulated or the robot's PLC, through the same ROS node
  startPlc(wsServer, () => getROSNode());
  startPanel(wsServer, () => getROSNode());

  // Runtime init
  setTimeout(async () => {
    await initializeRuntime();
  }, 500);

  // ✅ FIXED shutdown wiring
  const restart = setupGracefulShutdown({ server, wsServer, ros });

  // Drive tools (real drives through this ROS node, or simulated with the simulated robot)
  ecat.start(getROSNode()).catch((err) => log.error({ err }, "drive tools did not start"));
  // Software update of the whole console: waits while the robot or the drives work, compares
  // the robot connection and the drives before and after an update
  appUpdate.start({
    restart,
    simulated: () => Boolean(getROSNode()?.simulated),
    busy: () => {
      const reasons = busyReasons().map((r) => r.text);
      const drives = ecat.busy();
      if (drives.busy) reasons.push(drives.what);
      return { busy: reasons.length > 0, what: reasons.join("; ") };
    },
    health: async () => {
      const r = getROSNode();
      const d = await ecat.health().catch(() => ({ controller: false, drives: 0 }));
      return { robot: Boolean(r && !r.simulated && r.initialized), controller: Boolean(d.controller && !ecat.isMock()), drives: d.drives };
    },
    context: async () => {
      const r = getROSNode();
      const list = await ecat.listSlaves().catch(() => ({ slaves: [] }));
      return { robotConnected: Boolean(r?.initialized && !r.simulated), drives: (list.slaves || []).map((x) => ({ position: x.position, state: x.state, name: x.name })) };
    },
  });

  // the port taken (another console running) is fatal, unlike errors while serving
  server.on("error", (err) => {
    log.error({ err }, `the web server cannot start on port ${port}`);
    process.exit(1);
  });

  // ✅ USE server.listen NOT app.listen
  server.listen(port, () =>
    console.log(`Server running on http://localhost:${port}`)
  );
}

startServer();