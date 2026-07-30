import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDirectory, "..");
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
const maximumBodyBytes = 1024 * 1024;
const requestBuckets = new Map();

const routes = new Map([
  ["/", { path: join(projectRoot, "meituan.html"), contentType: "text/html; charset=utf-8" }],
  ["/meituan.html", { path: join(projectRoot, "meituan.html"), contentType: "text/html; charset=utf-8" }],
  ["/admin", { path: join(projectRoot, "admin-config.html"), contentType: "text/html; charset=utf-8" }],
  ["/admin-config.html", { path: join(projectRoot, "admin-config.html"), contentType: "text/html; charset=utf-8" }],
]);

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function clientAddress(request) {
  return request.socket.remoteAddress || "unknown";
}

function rateLimitExceeded(request, bucketName, maximumRequests, windowMs) {
  const address = `${clientAddress(request)}:${bucketName}`;
  const now = Date.now();
  const existing = requestBuckets.get(address);
  if (!existing || now - existing.startedAt >= windowMs) {
    requestBuckets.set(address, { startedAt: now, count: 1 });
    return false;
  }
  existing.count += 1;
  return existing.count > maximumRequests;
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBodyBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

async function proxyApi(request, response, configuration) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (
    rateLimitExceeded(
      request,
      configuration.bucketName,
      configuration.maximumRequests,
      configuration.windowMs,
    )
  ) {
    sendJson(response, 429, { error: "Too many requests. Please try again later." });
    return;
  }
  const apiKey = process.env[configuration.keyName]?.trim();
  if (!apiKey) {
    sendJson(response, 503, { error: "AI service is not configured." });
    return;
  }

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    sendJson(response, error?.message === "REQUEST_TOO_LARGE" ? 413 : 400, {
      error: error?.message === "REQUEST_TOO_LARGE" ? "Request is too large." : "Invalid request.",
    });
    return;
  }

  try {
    const upstream = await fetch(configuration.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(configuration.transformBody ? configuration.transformBody(body) : body),
      signal: AbortSignal.timeout(configuration.timeoutMs),
    });
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const bytes = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
  } catch (error) {
    sendJson(response, error?.name === "TimeoutError" ? 504 : 502, {
      error: error?.name === "TimeoutError" ? "AI service timed out." : "AI service is unavailable.",
    });
  }
}

async function serveFile(response, route) {
  try {
    const details = await stat(route.path);
    response.writeHead(200, {
      "Content-Type": route.contentType,
      "Content-Length": details.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    createReadStream(route.path).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      chatConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
      imageConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
    });
    return;
  }
  if (url.pathname === "/api/chat") {
    await proxyApi(request, response, {
      keyName: "DASHSCOPE_API_KEY",
      url:
        process.env.DASHSCOPE_CHAT_API_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      timeoutMs: 45_000,
      bucketName: "chat",
      maximumRequests: 30,
      windowMs: 60 * 60_000,
      transformBody: (body) => ({
        ...body,
        model: process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
      }),
    });
    return;
  }
  if (url.pathname === "/api/generate") {
    await proxyApi(request, response, {
      keyName: "DASHSCOPE_API_KEY",
      url: process.env.DASHSCOPE_IMAGE_API_URL || "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      timeoutMs: 180_000,
      bucketName: "image",
      maximumRequests: 6,
      windowMs: 60 * 60_000,
    });
    return;
  }

  const route = routes.get(url.pathname);
  if (!route) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  await serveFile(response, route);
});

server.requestTimeout = 190_000;
server.headersTimeout = 195_000;
server.listen(port, host, () => {
  console.log(`Meituan AI Image Studio listening on http://${host}:${port}`);
});
