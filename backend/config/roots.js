// Where nextup-react finds its files. Everything the app ships with lives in
// backend/user_config (resolved from this file, so the folder can be moved or
// renamed freely). The only folders outside the app are the robot's
// user_config_files and active_project_configs; each can be overridden.
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** backend/ of this app, wherever it was unpacked. */
export const BACKEND_ROOT = path.resolve(__dirname, "..");
/** Bundled config (templates, project defaults, layouts, faults, frame). */
export const APP_USER_CONFIG = path.join(BACKEND_ROOT, "user_config");

/** Home folder of the user running the app (/home/nextup on the robot); NEXTUP_HOME overrides it. */
const HOME = process.env.NEXTUP_HOME || os.homedir() || "/home/nextup";
/** ROS workspace (the URDF package). */
export const NEXTUP_WS = process.env.NEXTUP_WS || path.join(HOME, "NextupRobot");
/** Robot's user_config_files (projects, error_container, plc library...). */
export const USER_CONFIG_FILES = process.env.NEXTUP_USER_CONFIG_FILES || path.join(HOME, "user_config_files");
/** Live project the robot runs from: <home>/active_project_configs. */
export const ACTIVE_PROJECT_DIR = process.env.NEXTUP_ACTIVE_PROJECT || path.join(HOME, "active_project_configs");

