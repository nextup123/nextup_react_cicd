// The drive tools' toast(message, type, ms) on NextUp's toast stack (themed, deduplicated,
// file names kept off the screen like every other toast).
import { toast as appToast } from '../../../store/toast';
import { plainText } from '../../../lib/plainText';

const KIND = { success: 'success', error: 'error', warn: 'warning', info: 'info' };

export function toast(message, type = 'info', ms) {
  const fn = appToast[KIND[type] || 'info'];
  fn(plainText(String(message ?? '')), ms ? { duration: ms } : undefined);
}

export function dismissToast(id) {
  appToast.dismiss(id);
}

/** NextUp's own toast host shows them. */
export function Toasts() {
  return null;
}
