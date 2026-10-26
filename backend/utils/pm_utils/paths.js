import path from 'node:path';
import { USER_CONFIG_FILES, ACTIVE_PROJECT_DIR, APP_USER_CONFIG } from '../../config/roots.js';

const USER_CONFIG_ROOT = USER_CONFIG_FILES;
const PROJECTS_ROOT = `${USER_CONFIG_ROOT}/projects`;

// Hidden backup storage (OUTSIDE project folders)
const PROJECT_BACKUP_ROOT = `${USER_CONFIG_ROOT}/.project_backups`;

const ACTIVE_RUNTIME_PATH = ACTIVE_PROJECT_DIR;
// Shipped with the app (backend/user_config), never in a nextupWeb folder.
const TEMPLATE_PATH = path.join(APP_USER_CONFIG, 'pm_templates', 'default_project_template.json');
const DEFAULTS_DIR = path.join(APP_USER_CONFIG, 'pm_defaults');

export {
  USER_CONFIG_ROOT,
  PROJECTS_ROOT,
  PROJECT_BACKUP_ROOT,
  ACTIVE_RUNTIME_PATH,
  TEMPLATE_PATH,
  DEFAULTS_DIR
};
