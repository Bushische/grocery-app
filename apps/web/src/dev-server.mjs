// Placeholder dev server for the web container — replaced by the real Vite
// dev server in T14. Serves a stub page and proxies /api and /static to the
// api service so the container topology is exercised end-to-end.
import { createServer, request as httpRequest } from "node:http";

const port = Number(process.env.WEB_PORT ?? 5173);
const apiHost = process.env.API_HOST ?? "api";
const apiPort = Number(process.env.API_PORT ?? 3000);

function proxy(req, res) {
  const upstream = httpRequest(
    { host: apiHost, port: apiPort, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "BAD_GATEWAY", message: "api unreachable" } }));
  });
  req.pipe(upstream);
}

createServer((req, res) => {
  if (req.url.startsWith("/api") || req.url.startsWith("/static")) {
    proxy(req, res);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>My Groceries</title><h1>grocery-list web placeholder</h1>");
}).listen(port, () => {
  console.log(`[web placeholder] listening on :${port}`);
});
