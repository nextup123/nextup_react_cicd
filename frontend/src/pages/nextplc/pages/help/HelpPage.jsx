// HelpPage -- the NextPLC manuals, rendered in the app. A search across every manual (sections
// with a highlighted snippet), the list of manuals with the open one's contents (a pane that
// resizes or hides; the text then takes the width), and two reading styles: "Reading" (compact,
// the original) and "Cozy" (larger type, more air), remembered per robot.
import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { BookOpen, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { docsApi } from "../../lib/api";
import { toast } from "../../store/toast";
import { cx } from "../../components/ui";
import { Split } from "../../../../components/ui/Split";
import { plainText } from "../../../../lib/plainText";
import { usePref } from "../../lib/prefs";

const ORDER = ["LOGIC.md", "BLOCKS.md", "NEXTPLC_MANUAL.md"];
const TITLES = { "LOGIC.md": "How to write the logic", "BLOCKS.md": "The block library", "NEXTPLC_MANUAL.md": "Full manual" };
const SUBTITLES = { "LOGIC.md": "rungs, timers, sequences, alarms", "BLOCKS.md": "ready-made blocks and your own", "NEXTPLC_MANUAL.md": "everything, start to end" };

/** Split a manual into its headed sections (fenced code is not a heading). */
function sections(text) {
  const out = [];
  let cur = { level: 0, title: "", lines: [] };
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) { out.push(cur); cur = { level: m[1].length, title: m[2].replace(/[`*_]/g, "").trim(), lines: [] }; }
    else cur.lines.push(line);
  }
  out.push(cur);
  return out.map((s, i) => ({ ...s, index: i - 1, body: s.lines.join("\n") })).filter((s) => s.index >= 0 || s.body.trim());
}
const stripMd = (s) => s.replace(/```[\s\S]*?```/g, (c) => c.replace(/```\w*/g, "")).replace(/[`*_>#|]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Snippet({ text, words }) {
  const flat = stripMd(text);
  const re = new RegExp(`(${words.map(escapeRe).join("|")})`, "ig");
  const at = flat.search(re);
  const start = Math.max(0, at - 60);
  const cut = (start > 0 ? "…" : "") + flat.slice(start, start + 180) + (flat.length > start + 180 ? "…" : "");
  return <span className="hit-snip">{cut.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</span>;
}

export default function HelpPage() {
  const [docs, setDocs] = useState([]); // [{ name, title, text, sections }]
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState(null); // { name, index, at }
  const [style, setStyle] = usePref("helpStyle", "reading");
  const [showList, setShowList] = usePref("helpList", true);
  const articleRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    docsApi.list().then(async (r) => {
      const list = [...r.docs].filter((d) => !/simulat/i.test(d.name)).sort((a, b) => (ORDER.indexOf(a.name) + 99) % 99 - (ORDER.indexOf(b.name) + 99) % 99);
      const full = await Promise.all(list.map((d) => docsApi.read(d.name).then((x) => ({ ...d, text: x.text || "" })).catch(() => ({ ...d, text: "" }))));
      if (!alive) return;
      setDocs(full.map((d) => ({ ...d, sections: sections(d.text) })));
      setName((n) => n || full[0]?.name || "");
    }).catch((e) => toast.error(plainText(e.message)));
    return () => { alive = false; };
  }, []);

  const doc = docs.find((d) => d.name === name);
  const html = useMemo(() => (doc?.text ? marked.parse(doc.text) : ""), [doc]);
  const words = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 2), [query]);
  const hits = useMemo(() => {
    if (!words.length) return [];
    const out = [];
    for (const d of docs) for (const s of d.sections) {
      const hay = `${s.title} ${s.body}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const score = words.reduce((n, w) => n + (s.title.toLowerCase().includes(w) ? 10 : 0) + hay.split(w).length - 1, 0);
      out.push({ doc: d, s, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [docs, words]);

  // heading ids, highlights and the jump to a section, after each render of the text
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    el.querySelectorAll("h1, h2, h3").forEach((h, i) => { h.id = `help-sec-${i}`; });
    el.querySelectorAll("mark.help-hit").forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
    el.normalize();
    if (words.length) {
      const re = new RegExp(`(${words.map(escapeRe).join("|")})`, "ig");
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
      for (const n of nodes) {
        const frag = document.createDocumentFragment();
        n.nodeValue.split(re).forEach((p, i) => {
          if (i % 2) { const m = document.createElement("mark"); m.className = "help-hit"; m.textContent = p; frag.appendChild(m); }
          else if (p) frag.appendChild(document.createTextNode(p));
        });
        n.replaceWith(frag);
      }
    }
    if (jump && jump.name === name) {
      const target = jump.index >= 0 ? el.querySelector(`#help-sec-${jump.index}`) : null;
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
      else scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [html, words, jump, name]);

  const openDoc = (n, index = -1) => { setName(n); setJump({ name: n, index, at: Date.now() }); };
  const toc = doc ? doc.sections.filter((s) => s.index >= 0 && s.level <= 2 && s.title) : [];

  const side = showList && (
    <div key="list" className="panel help-side">
      <div className="panel-head"><h3>{words.length ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}` : "Manuals"}</h3><span className="grow" /><button data-tut="plc-help-hide" className="btn sm icon ghost" onClick={() => setShowList(false)} title="Hide this list: the text takes the whole width"><PanelLeftClose size={14} /></button></div>
      <div className="panel-body">
        {words.length ? (
          hits.length ? <div className="liblist" data-tut="plc-help-hits">{hits.map((h, i) => (
            <button key={i} className={cx("libitem hit", h.doc.name === name && jump?.index === h.s.index && "active")} onClick={() => openDoc(h.doc.name, h.s.index)}>
              <b>{h.s.title || TITLES[h.doc.name] || h.doc.title}</b>
              <span className="xs muted">{TITLES[h.doc.name] || h.doc.title}</span>
              <Snippet text={h.s.body || h.s.title} words={words} />
            </button>
          ))}</div> : <div className="empty">Nothing found for <b>{query.trim()}</b>.</div>
        ) : (
          <>
            <div className="liblist" data-tut="plc-help-docs">
              {docs.map((d) => <button key={d.name} className={cx("libitem", d.name === name && "active")} onClick={() => openDoc(d.name)}><b>{TITLES[d.name] || d.title}</b><span>{SUBTITLES[d.name] || ""}</span></button>)}
              {!docs.length && <div className="empty">The manuals are not installed on this computer.</div>}
            </div>
            {toc.length > 0 && (
              <div className="help-toc" data-tut="plc-help-toc">
                <div className="xs muted">On this page</div>
                {toc.map((s) => <button key={s.index} className={cx("toc-item", s.level === 2 && "sub")} onClick={() => openDoc(name, s.index)}>{s.title}</button>)}
              </div>
            )}
            <div className="col help-note" data-tut="plc-help-note">
              <div className="xs muted">The picture in your head</div>
              <div className="small">Every <b>10 ms</b>: read the inputs, run the rungs top to bottom, run the sequences, write the outputs that changed. A coil writes every scan; SET / RESET remember; RISE lasts one scan; timers count real time.</div>
              <div className="small">Only <span className="mono">M</span> and <span className="mono">R</span> can be written from outside. <span className="mono">Q</span> only through a rung. Only outputs in the program are controlled.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="page">
      <Split id="plc.help" defaults={[1, 3]} min={[240, 420]} className="plc-split">
        {side}
        <div key="doc" className="panel help-main">
          <div className="panel-head help-bar">
            {!showList && <button data-tut="plc-help-show" className="btn sm icon ghost" onClick={() => setShowList(true)} title="Show the list of manuals"><PanelLeftOpen size={14} /></button>}
            <div className="help-search" data-tut="plc-help-search">
              <Search size={14} />
              <input className="input" value={query} placeholder="Search the manuals…" onChange={(e) => { setQuery(e.target.value); if (!showList) setShowList(true); }} onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) openDoc(hits[0].doc.name, hits[0].s.index); if (e.key === "Escape") setQuery(""); }} aria-label="Search the manuals" />
              {query && <button className="btn sm icon ghost" onClick={() => setQuery("")} title="Clear the search"><X size={13} /></button>}
            </div>
            <span className="help-doc-title truncate"><BookOpen size={14} />{doc ? TITLES[doc.name] || doc.title : ""}</span>
            <span className="grow" />
            <div data-tut="plc-help-style" className="style-toggle" role="radiogroup" aria-label="Reading style">
              {[["reading", "Reading"], ["cozy", "Cozy"]].map(([id, label]) => <button key={id} role="radio" aria-checked={style === id} className={cx(style === id && "on")} onClick={() => setStyle(id)}>{label}</button>)}
            </div>
          </div>
          <div ref={scrollRef} data-tut="plc-help-text" className={cx("panel-body help-scroll", style === "cozy" && "cozy")}>
            <article ref={articleRef} className={cx("doc", style === "cozy" && "cozy")} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </Split>
    </div>
  );
}
