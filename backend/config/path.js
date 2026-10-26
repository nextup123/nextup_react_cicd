import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Folder roots come from roots.js (env overridable); no nextupWeb folder.
import { ACTIVE_PROJECT_DIR as AP, USER_CONFIG_FILES as UCF, APP_USER_CONFIG, NEXTUP_WS } from "./roots.js";

export const TREE_LAYOUT_DIR = path.join(__dirname, "../routes/tree_layout");

export const pointPlanningFilePath = {
  POINTS_YAML_FILE:
    `${AP}/planning_data/points.yaml`,
  POINTS_BACKUP_YAML_FILE: "points_backup.yaml",
};

export const ioFilePath = {
  DO_DI_TREE_XML_FILE:
    `${AP}/control_data/do_di.xml`,
  DO_DI_TREE_XML_BACKUP_FILE:
    `${AP}/control_data/do_di_backup.xml`,
};

export const ERROR_LOGS_PATH =
  `${UCF}/error_container/error_logs.yaml`;

export const DESCRIPTION_PATH =
  `${UCF}/error_container/description_error.txt`;

export const COMMANDS_PATH =
  `${UCF}/error_container/commands.json`;

export const OPEN_TERMINAL_PATH =
  `${UCF}/error_container/always_on_top_terminal.sh`;

export const XML_BASE_DIR =
  `${AP}/control_data`;

export const LAYOUTS_DIR = path.join(__dirname, "../config/layouts");

export const TEMPLATE_PATH =
  `${AP}/control_data/template.xml`;

export const LOGS_JSON_FILE = `${AP}/logs.json`;
export const LIVE_LOGS_JSON_FILE = `${UCF}/live_logs.json`;
export const NODES_JSON_PATH = `${UCF}/nodes.json`;

export const FAULTJSONPATH = path.join(APP_USER_CONFIG, "faults.json");
export const SERVO_FRAME_FILE = path.join(APP_USER_CONFIG, "frame.json");

// ── Robot models for the 3D view and the simulator ──
// Every *.urdf.xacro / *.xacro / *.urdf in URDF_DIR shows up in the 3D view's
// model list (a new file appears without a code change). package:// mesh
// paths are resolved in PACKAGE_DIRS (source and install trees) and in
// $AMENT_PREFIX_PATH. DESCRIPTION_XACRO is the file ROS loads; its
// robot_type property marks the model the robot itself uses.
export const robotModelPaths = {
  URDF_DIR: process.env.NEXTUP_URDF_DIR || `${NEXTUP_WS}/src/nextup_moveit_config/urdf`,
  PACKAGE_DIRS: [`${NEXTUP_WS}/src`, `${NEXTUP_WS}/install`],
  DESCRIPTION_XACRO: `${NEXTUP_WS}/src/nextup_moveit_config/config/robot_nextup.urdf.xacro`,
};
