import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript"
};

export function startFixtureServer(port, fixtureDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const pathname = req.url === "/" ? "/top-product.html" : req.url;
      const filePath = path.join(fixtureDir, pathname);

      try {
        const content = await readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { "content-type": MIME[ext] || "text/plain" });
        res.end(content);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
      }
    });

    server.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}
