'use strict';

// ethercat/config.js -- settings of the drive tools (Settings > Driver Settings, Diagnostics >
// Robot records > Drive faults), merged from the EtherCAT Config Tool v3.8.
//
// Files:
//   backend/ethercat/data/        reference files that ship with the app (fault guide, parameter
//                                 catalog, SDO presets) and the starter recipes / drive settings
//   <user_config_files>/ethercat  the operator's own files (recipes, drive settings, history,
//                                 fault snapshots). Copied from data/ on the first start; a software
//                                 update never touches them.
// The roots follow backend/config/roots.js (same environment variables).

const os = require('os');
const path = require('path');

const HERE = __dirname;
const HOME = process.env.NEXTUP_HOME || os.homedir() || '/home/nextup';
const USER_CONFIG_FILES = process.env.NEXTUP_USER_CONFIG_FILES || path.join(HOME, 'user_config_files');

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

module.exports = {
  ROOT: HERE,
  HOME,
  DATA_DIR: process.env.ECAT_DATA_DIR ? path.resolve(process.env.ECAT_DATA_DIR) : path.join(USER_CONFIG_FILES, 'ethercat'),
  BUNDLED_DATA_DIR: path.join(HERE, 'data'),

  // Password for Manual read/write, starting drive communication and the software update.
  // Checked on the server. ECAT_PASSWORD wins; SDO_PASSWORD is the tool's old name for it.
  SDO_PASSWORD: process.env.ECAT_PASSWORD || process.env.SDO_PASSWORD || '123',

  // Simulated drives: ECAT_MOCK=1, or when the console runs its simulated robot (npm run sim,
  // or no ROS 2 on this PC). ECAT_MOCK=0 forces the real drives.
  MOCK_ENV: process.env.ECAT_MOCK,

  ROS_SETUP: process.env.ROS_SETUP || '/opt/ros/humble/setup.bash',
  // Optional overlay with ethercat_manager / ethercat_msgs (e.g. ~/ros2_ws/install/setup.bash).
  // Sourced after ROS_SETUP when starting drive communication.
  WORKSPACE_SETUP: process.env.WORKSPACE_SETUP || '',
  ETHERCAT_BIN: process.env.ETHERCAT_BIN || '/usr/bin/ethercat',

  SDO_SET_SERVICE: { type: 'ethercat_msgs/srv/SetSdo', name: '/ethercat_manager/set_sdo' },
  SDO_GET_SERVICE: { type: 'ethercat_msgs/srv/GetSdo', name: '/ethercat_manager/get_sdo' },
  SERVICE_TIMEOUT_MS: Number(process.env.SERVICE_TIMEOUT_MS) || 5000,

  DEFAULT_NODE: { node_name: 'ethercat_sdo_srv_server', package_name: 'ethercat_manager' },

  FAULT_RESET: { index: 0x6040, subindex: 0x00, dtype: 'uint16', value: '128' },

  MAX_LOG_SNAPSHOTS: 500,
  envBool,
};
