// Fetch the code of every page in the background once the console runs (list made at build
// time: page-chunks.json). The browser keeps it, so opening a page later never waits for a
// download or fails because the server is restarting. Nothing is run: modulepreload only
// downloads and parses.
let done = false;
export function preloadPageCode() {
  if (done) return;
  done = true;
  fetch("/page-chunks.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : []))
    .then((files) => {
      const have = new Set([...document.querySelectorAll("link[href], script[src]")].map((el) => el.getAttribute("href") || el.getAttribute("src")));
      for (const f of files) {
        const href = `/${f}`;
        if (have.has(href)) continue;
        const link = document.createElement("link");
        link.rel = f.endsWith(".css") ? "prefetch" : "modulepreload";
        link.href = href;
        document.head.appendChild(link);
      }
    })
    .catch(() => {
      done = false; // try again next time
    });
}
