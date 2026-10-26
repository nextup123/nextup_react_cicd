// Watches the page in the main area: if it has not come up 10 s after it was opened (its code
// still loading, or nothing but a spinner on screen), a notice covers it with "Reload page" and
// the web app reloads itself a few seconds later (lib/pageReload.js says when that is allowed).
// The page keeps loading underneath; if it arrives meanwhile the notice goes away.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hourglass, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../components/ui";
import { autoReloadAllowed, reloadApp, reloadPage, serverAnswers } from "../lib/pageReload";

const SLOW_MS = 10_000; // after the reads and code fetches have been retried (lib/retry.js)
const COUNTDOWN_S = 5;

/** Rendered after the page inside its Suspense: mounts only once the page's code is there. */
export function PageMounted({ onMount }) {
  useLayoutEffect(() => onMount(), [onMount]);
  return null;
}

/** Nothing of the page on screen yet: no content, or only a "Loading…" spinner. */
function looksEmpty(host) {
  if (!host) return true;
  const text = (host.innerText || "").replace(/\s+/g, " ").trim();
  if (!text && !host.querySelector("canvas, svg, input, button")) return true;
  return text.length < 40 && Boolean(host.querySelector(".spinner")) && !host.querySelector("button, input, canvas");
}

export function usePageLoadWatch(hostRef) {
  const mounted = useRef(false);
  const [slow, setSlow] = useState(false);
  const markMounted = useRef(() => {
    mounted.current = true;
  }).current;

  useEffect(() => {
    let timer = 0;
    const loaded = () => mounted.current && !looksEmpty(hostRef.current);
    const check = () => {
      if (document.visibilityState !== "visible") return; // a hidden tab is checked when shown
      if (loaded()) {
        setSlow(false);
        clearInterval(timer);
      } else setSlow(true);
    };
    const start = setTimeout(() => {
      check();
      timer = setInterval(check, 500); // the notice goes away as soon as the page arrives
    }, SLOW_MS);
    const onVis = () => document.visibilityState === "visible" && timer && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [hostRef]);

  return { slow, markMounted };
}

export function PageLoadFallback({ title = "This page is taking too long to load", countdown = COUNTDOWN_S }) {
  const [allowed] = useState(autoReloadAllowed);
  const [left, setLeft] = useState(allowed ? countdown : null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    if (left == null) return undefined;
    if (left > 0) {
      const t = setTimeout(() => setLeft((n) => (n == null ? n : n - 1)), 1000);
      return () => clearTimeout(t);
    }
    let gone = false;
    // reload only against a server that answers; otherwise wait for it
    (async () => {
      while (!gone) {
        if (await serverAnswers()) {
          reloadApp({ auto: true });
          return;
        }
        setServerDown(true);
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => {
      gone = true;
    };
  }, [left]);

  return (
    <div className="page-load-fallback" role="alert">
      <div className="page-load-card">
        <Hourglass size={26} />
        <h2>{title}</h2>
        <p className="small muted">
          {serverDown
            ? "The robot server does not answer. The web app reloads as soon as it is back."
            : left == null
              ? allowed
                ? "Automatic reload is off for this page. Reload it, or open another page from the menu."
                : "It did not come up after two automatic reloads. Reload the page, or open another page from the menu."
              : left > 0
                ? `The web app reloads in ${left} s.`
                : "Reloading the web app…"}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Button variant="primary" icon={RotateCcw} onClick={reloadPage} title="Load this page again (Alt+R)">
            Reload page
          </Button>
          <Button icon={RefreshCw} onClick={() => reloadApp()} title="Reload the whole web app (Alt+Shift+R)">
            Reload web app now
          </Button>
          {left != null && left > 0 && (
            <Button variant="ghost" onClick={() => setLeft(null)}>
              Don't reload
            </Button>
          )}
        </div>
        <p className="xs muted">Shortcuts: Alt+R reloads this page, Alt+Shift+R the whole web app.</p>
      </div>
    </div>
  );
}
