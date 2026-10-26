//backend - rosController.js

import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { extractNodes, getParsedXml } from "./rosHelper.js";
import { getROSNode } from "./rosService.js";
import { LOGS_JSON_FILE } from "../config/path.js";
import { loadYAML } from "../service/pointPlanningBtService.js";
import { startMotion, stopMotion } from "./robotOps.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DO_LAYOUT_PATH = path.join(
  __dirname,
  "../user_config/layouts/do_layout.json",
);

const SETTINGS_PATH = path.join(__dirname, "../user_config/user_settings.json");

const DI_LAYOUT_PATH = path.join(
  __dirname,
  "../user_config/layouts/di_layout.json",
);

// Ensure directories exist
await fs.mkdir(path.dirname(DO_LAYOUT_PATH), { recursive: true });
await fs.mkdir(path.dirname(DI_LAYOUT_PATH), { recursive: true });

export const doListController = async (req, res) => {
  try {
    const jsonRoot = await getParsedXml();

    const driverDOs = extractNodes(jsonRoot, "DoControl").map(attr => ({
      type: "driver",
      name: attr.name,
      driver_id: attr.driver_id,
      do_id: attr.do_id,
      type_of_control: attr.type_of_control,
      ...(attr.type_of_control === "push"
        ? { push_wait: attr.push_wait }
        : {})
    }));

    const gpioDOs = extractNodes(jsonRoot, "GpioDoControl").map(attr => ({
      type: "gpio",
      name: attr.name,
      gpio_id: attr.gpio_id,      // or gpio_name/group_name depending on XML
      do_id: attr.do_id,
      type_of_control: attr.type_of_control,
      ...(attr.type_of_control === "push"
        ? { push_wait: attr.push_wait }
        : {})
    }));

    const doNodes = [...driverDOs, ...gpioDOs];

    res.json({
      count: doNodes.length,
      data: doNodes,
    });
  } catch (err) {
    console.error("Error reading DOs:", err);
    res.status(500).json({
      error: "Failed to read DO list",
      details: err.message,
    });
  }
};

export const getDoLayoutController = async (req, res) => {
  try {
    const data = await fs.readFile(DO_LAYOUT_PATH, "utf-8").catch(() => null);

    if (!data) return res.json({});

    res.json(JSON.parse(data));
  } catch (e) {
    console.error("Failed to read DO layout:", e);
    res.status(500).json({ error: "Failed to load DO layout" });
  }
};

export const postDoLayoutController = async (req, res) => {
  try {
    const tmp = DO_LAYOUT_PATH + ".tmp";

    await fs.writeFile(tmp, JSON.stringify(req.body, null, 2));
    await fs.rename(tmp, DO_LAYOUT_PATH);

    res.json({ status: "ok" });
  } catch (e) {
    console.error("Failed to save DO layout:", e); {
      res.status(500).json({ error: "Failed to save DO layout" });
    }
  };
}
export const diListController = async (req, res) => {
  try {
    const jsonRoot = await getParsedXml();
    const driverDIs = extractNodes(jsonRoot, "DIControl").map(attr => ({
      type: "driver",
      name: attr.name,
      driver_id: attr.driver_id,
      di_id: attr.di_id
    }));

    const gpioDIs = extractNodes(jsonRoot, "GpioDiControl").map(attr => ({
      type: "gpio",
      name: attr.name,
      gpio_id: attr.gpio_id,
      di_id: attr.di_id
    }));

    const diNodes = [...driverDIs, ...gpioDIs];

    res.json({
      count: diNodes.length,
      data: diNodes,
    });
  } catch (err) {
    console.error("Error reading DIs:", err);
    res.status(500).json({
      error: "Failed to read DI list",
      details: err.message,
    });
  }
};

export const getDiLayoutController = async (req, res) => {
  try {
    const data = await fs.readFile(DI_LAYOUT_PATH, "utf-8").catch(() => null);

    if (!data) return res.json({});

    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Failed to read DI layout:", err);
    res.status(500).json({ error: "Failed to load DI layout" });
  }
};

export const postDiLayoutController = async (req, res) => {
  try {
    const layout = req.body;

    if (typeof layout !== "object") {
      return res.status(400).json({ error: "Invalid layout format" });
    }

    const tempPath = DI_LAYOUT_PATH + ".tmp";

    await fs.writeFile(tempPath, JSON.stringify(layout, null, 2));
    await fs.rename(tempPath, DI_LAYOUT_PATH);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("Failed to save DI layout:", err);
    res.status(500).json({ error: "Failed to save DI layout" });
  }
};

// Stop the current motion: motion server ~/stop (MoveIt stop as a fallback).
export const publishMoveitStopController = async (req, res) => {
  try {
    const ros = getROSNode();
    if (!ros) return res.status(500).json({ error: "ROS not initialized" });
    const result = await stopMotion(ros);
    res.json({ status: result.message, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to stop the current motion" });
  }
};

export async function getLogsController(req, res) {
  try {
    const data = await fs.readFile(LOGS_JSON_FILE, "utf-8");
    const logs = JSON.parse(data);
    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    console.error("Error reading logs:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch logs",
    });
  }
}

// ════════════════════════════════════════════════════════════════════
// Jog frame: ui_command_node/set_frame (it answers, and refuses a frame that
// is not in TF or a change during a Cartesian jog)
// ════════════════════════════════════════════════════════════════════
export async function getServoFrameController(req, res) {
  try {
    const ros = getROSNode();
    if (!ros) return res.status(500).json({ success: false, error: "ROS not initialized" });
    const r = await ros.callService("setJogFrame", { frame: "" }, { timeoutMs: 1500, waitMs: 0 });
    if (r.ok && r.response.frame) ros.currentFrame = r.response.frame;
    res.json({ success: true, frame: ros.getCurrentFrame(), live: r.ok });
  } catch (err) {
    console.error("Error getting servo frame:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function setFrameController(req, res) {
  const { frame } = req.body;
  if (!frame || typeof frame !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "frame" field' });
  }
  const ros = getROSNode();
  if (!ros) return res.status(500).json({ error: "ROS not initialized" });
  const r = await ros.callService("setJogFrame", { frame }, { timeoutMs: 2000 });
  if (!r.ok) return res.status(503).json({ success: false, message: r.message });
  if (r.response.success === false) return res.status(409).json({ success: false, message: r.response.message, frame: r.response.frame });
  ros.currentFrame = r.response.frame || frame;
  ros.saveServoFrame(ros.currentFrame);
  res.json({ success: true, frame: ros.currentFrame, message: r.response.message });
}

// Move to a taught point through the motion server (goto_point). The old
// "get_last_pose@NAME" form and the separate motion-type call are still
// accepted: the motion type given here, or the last one set, is used.
let lastMotionType = "joint";

export const moveToPointController = async (req, res) => {
  try {
    const { pointName, motionType, speed, acceleration, planner, approachMm, retractMm, dryRun } = req.body || {};
    if (!pointName) return res.status(400).json({ message: 'Point name is required' });
    const target = String(pointName).includes('@') ? String(pointName).split('@')[1] : String(pointName);

    const data = await loadYAML();
    if (!data.points?.find(p => p.name === target)) {
      return res.status(404).json({ message: `Point ${target} not found` });
    }
    const type = motionType || lastMotionType;
    const result = await startMotion(getROSNode(), 'gotoPoint', {
      point_name: target,
      motion_type: type === 'cartesian' || type === 'LIN' ? 'LIN' : 'PTP',
      speed_mps: Math.max(0, Number(speed) || 0),
      acceleration_mps2: Math.max(0, Number(acceleration) || 0),
      planner: planner ? String(planner) : '',
      approach_mm: Math.max(0, Number(approachMm) || 0),
      retract_mm: Math.max(0, Number(retractMm) || 0),
      use_cache: false,
      dry_run: Boolean(dryRun),
    });
    if (result.unavailable) return res.status(503).json({ success: false, ...result });
    res.json({ success: result.ok, ...result, message: result.ok ? `Moving to ${target}` : result.message });
  } catch (err) {
    console.error('Error in /moveToPoint:', err);
    res.status(500).json({ message: err.message });
  }
};

export const setMotionTypeController = async (req, res) => {
  const { motionType } = req.body || {};
  if (!['cartesian', 'joint'].includes(motionType)) {
    return res.status(400).json({ message: 'motionType must be "cartesian" or "joint"' });
  }
  // No topic any more: the motion type is part of every goto_point request.
  lastMotionType = motionType;
  res.json({ success: true, message: `Motion type set to ${motionType}` });
};

// Planner = the motion server's go-to default planner (goto/get_config, goto/set_config).
export async function getPlannerStateController(req, res) {
  const ros = getROSNode();
  const r = await ros.callService('getGotoConfig', {}, { timeoutMs: 1500 });
  if (!r.ok) return res.status(503).json({ success: false, message: r.message });
  const planner = String(r.response.config?.default_planner || 'pilz').toLowerCase() === 'ompl' ? 'OMPL' : 'PILZ';
  res.json({ success: true, planner, isPilz: planner === 'PILZ' });
}

export async function togglePlannerController(req, res) {
  try {
    const { isPilz } = req.body;
    if (typeof isPilz !== "boolean") {
      return res.status(400).json({ success: false, message: "isPilz must be a boolean" });
    }
    const ros = getROSNode();
    const cur = await ros.callService('getGotoConfig', {}, { timeoutMs: 1500 });
    if (!cur.ok) return res.status(503).json({ success: false, message: cur.message });
    const config = { ...cur.response.config, default_planner: isPilz ? 'pilz' : 'ompl' };
    const r = await ros.callService('setGotoConfig', { config, persist: true }, { timeoutMs: 2000 });
    if (!r.ok) return res.status(503).json({ success: false, message: r.message });
    if (r.response.success === false) return res.status(502).json({ success: false, message: r.response.message });
    res.json({
      success: true,
      planner: isPilz ? "PILZ" : "OMPL",
      message: isPilz ? "Default planner: PILZ" : "Default planner: OMPL (joint moves only; straight lines always use PILZ or the Cartesian planner)",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
