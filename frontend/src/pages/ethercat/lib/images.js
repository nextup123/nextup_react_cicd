// Screenshots for problem reports: shrunk in the browser so a report with pictures
// still goes quickly over a weak connection (about 300 KB each, longest side 1600 px).

export const MAX_IMAGES = 5;
const TARGET_BYTES = 300 * 1024;
const MAX_SIDE = 1600;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name || 'The picture'} is not a picture this browser can open`)); };
    img.src = url;
  });
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read the picture'));
  r.readAsDataURL(blob);
});

/** A picture file → { name, data (base64 JPEG), preview (data URL), size }. */
export async function shrinkImage(file) {
  const img = await loadImage(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  let blob = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNG parts become white instead of black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.7, 0.55]) {
      blob = await toBlob(canvas, q);
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (blob && blob.size <= TARGET_BYTES) break;
    scale *= 0.75;
  }
  if (!blob) throw new Error('Could not shrink the picture');
  const preview = await toDataUrl(blob);
  const name = (file.name || 'screenshot').replace(/\.[^.]+$/, '') || 'screenshot';
  return { name: `${name}.jpg`, data: preview.split(',')[1], preview, size: blob.size };
}
