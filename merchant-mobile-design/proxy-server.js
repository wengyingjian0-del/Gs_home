import { createReadStream, createWriteStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, "pages");
const port = Number(process.env.PORT || 3002);
const REMOTE_API = process.env.REMOTE_API || "http://localhost:3001";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function serveStatic(response, filePath) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
    const ext = extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("404 Not Found");
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  setCors(response);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://localhost:${port}`);
  const pathname = url.pathname;

  // Proxy API requests to remote backend
  if (pathname.startsWith("/api/")) {
    try {
      const body = request.method === "POST" ? await readBody(request) : null;
      const upstream = await fetch(`${REMOTE_API}${pathname}`, {
        method: request.method,
        headers: {
          "Content-Type": request.headers["content-type"] || "application/json",
        },
        body: body,
        signal: AbortSignal.timeout(180_000),
      });

      const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
      const bytes = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      response.end(bytes);
    } catch (error) {
      console.error("Proxy error:", error.message);
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: `Proxy error: ${error.message}` }));
    }
    return;
  }

  // Serve static files
  let filePath;
  if (pathname === "/" || pathname === "") {
    filePath = join(pagesDir, "admin-login.html");
  } else if (pathname.startsWith("/assets/")) {
    filePath = join(__dirname, pathname);
  } else {
    filePath = join(pagesDir, pathname);
  }

  await serveStatic(response, filePath);
});

server.listen(port, () => {
  console.log(`\n  商图 Mobile Dev Server running at:`);
  console.log(`  → http://localhost:${port}`);
  console.log(`  → API proxy → ${REMOTE_API}`);
  console.log(`\n  Pages: workspace.html | result.html | profile.html | viewer.html`);
  console.log(`  Admin: admin-login.html → admin.html\n`);
});
