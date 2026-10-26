import { highlightParts } from "./logUtils";

export function Highlight({ text, term }) {
  if (!term) return text ?? "";
  return highlightParts(text, term).map((p, i) => (p.hit ? <mark key={i} className="dg-mark">{p.text}</mark> : <span key={i}>{p.text}</span>));
}
