import { existsSync, mkdirSync, writeFileSync } from "node:fs";
// Placeholder dev server for the api container — replaced by the real Fastify
// app in T4. Keeps `docker compose up` functional before T4 exists.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const uploadsPath = process.env.UPLOADS_PATH ?? "/data/images";

mkdirSync(uploadsPath, { recursive: true });
if (!existsSync(`${uploadsPath}/.keep`)) {
  writeFileSync(`${uploadsPath}/.keep`, "");
}

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
}).listen(port, () => {
  console.log(`[api placeholder] listening on :${port}`);
});
