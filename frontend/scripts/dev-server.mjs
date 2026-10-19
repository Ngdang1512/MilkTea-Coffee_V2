import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const portals = [
  { name: "Admin", port: 4173, entrypoint: "/views/admin/index.html" },
  { name: "Manager", port: 4174, entrypoint: "/views/manager/index.html" },
  { name: "Customer", port: 4175, entrypoint: "/views/front/index.html" }
];
const portalPorts = { "/admin": 4173, "/manager": 4174, "/customer": 4175 };

for (const portal of portals) {
  createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const requestedPortalPort = portalPorts[url.pathname.replace(/\/+$/, "")];
      if (requestedPortalPort) {
        url.port = String(requestedPortalPort);
        url.pathname = "/";
        url.search = "";
        response.writeHead(302, { Location: url.toString() });
        response.end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname === "/" ? portal.entrypoint : url.pathname);
      const target = normalize(join(root, pathname));
      if (!target.startsWith(root)) throw new Error("Invalid path");
      if (!(await stat(target)).isFile()) throw new Error("Not a file");
      response.writeHead(200, { "Content-Type": mime[extname(target)] || "application/octet-stream" });
      response.end(await readFile(target));
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Không tìm thấy tài nguyên");
    }
  }).listen(portal.port, () => console.log(`${portal.name} đang chạy tại http://127.0.0.1:${portal.port}`));
}
