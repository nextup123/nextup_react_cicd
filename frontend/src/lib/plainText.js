// Keeps file names, extensions and folder paths off the screen: the operator
// sees "main_tree", never "/home/nextup/.../control_data/main_tree.xml".
// Only Diagnostics and Settings show the real names.

const EXT = "ya?ml|xml|json|xacro|urdf|launch|py|bak|fbl|csv|txt|log|stl|dae|cfg|ini|sh|db3|mcap|zip";
const EXT_TAIL = new RegExp(`(\\.(?:${EXT}))+$`, "i");
// Two or more "/segment" parts that do not follow a letter, digit or ":" (so
// "DO/DI", "mm/s" and URLs stay as they are).
const PATH_RE = /(?<![\w:/])~?(?:\/[\w.@+-]+){2,}\/?/g;
const FILE_RE = new RegExp(`\\b([\\w-]+(?:\\.[\\w-]+)*?)(?:\\.(?:${EXT}))+\\b`, "gi");

/** "dir/sub/main_tree.xml" → "main_tree"; "programs.yaml.bak" → "programs". */
export function plainName(name) {
  if (name == null) return name;
  const base = String(name).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return base.replace(EXT_TAIL, "") || base;
}

/** Same for every path and file name inside a free-text message (server errors, toasts). */
export function plainText(text) {
  if (typeof text !== "string" || !text) return text;
  return text
    .replace(PATH_RE, (p) => plainName(p))
    .replace(FILE_RE, "$1")
    .replace(/\b(?:YAML|XML|JSON)\b/g, "file");
}
