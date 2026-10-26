// Settings > Software Update: the update of the whole console and problem reports
// (backend/update, mounted at /update-api).
import { request } from './api';

const opts = (o) => ({ base: '/update-api', ...o });
const get = (p, o) => request('GET', p, undefined, opts(o));
const post = (p, b, o) => request('POST', p, b ?? {}, opts(o));
const put = (p, b, o) => request('PUT', p, b, opts(o));

export const api = {
  health: () => get('/health', { timeout: 4000 }),
  updateStatus: () => get('/updates/status'),
  checkUpdates: () => post('/updates/check', {}, { timeout: 15 * 60 * 1000 }),
  installUpdate: (version, password) => post('/updates/install', { version, password }),
  rollbackUpdate: (password, restoreData = true) => post('/updates/rollback', { password, restoreData }),
  restartApp: (password) => post('/updates/restart', { password }),
  verifyPassword: (password) => post('/auth/verify', { password }),
  saveUpdateSettings: (data, password) => put('/updates/settings', { ...data, password }),
  updateHistory: () => get('/updates/history'),
  reports: () => get('/reports'),
  sendReport: (report) => post('/reports', report, { timeout: 30000 }),
  sendWaitingReports: () => post('/reports/send', {}, { timeout: 60000 }),
};
