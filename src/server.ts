/**
 * Tiny zero-dependency HTTP server used by `cueframe play` (and the acceptance
 * script) to serve the player and frame screenshots locally.
 */
import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, resolve } from "node:path";
import { renderPlayerHtml } from "./player/index.js";
import type { Spec } from "./spec/index.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

export interface ServeHandle {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(port, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") res(addr.port);
      else rej(new Error("could not determine server port"));
    });
  });
}

function wrap(server: Server, port: number): ServeHandle {
  return {
    server,
    port,
    url: `http://localhost:${port}/`,
    close: () =>
      new Promise<void>((res) => server.close(() => res())),
  };
}

async function sendFile(root: string, urlPath: string, res: import("node:http").ServerResponse): Promise<void> {
  let filePath = normalize(join(root, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

/** Serve a directory of static files. `port: 0` picks an ephemeral port. */
export async function serveStatic(root: string, port = 0): Promise<ServeHandle> {
  const abs = resolve(root);
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    void sendFile(abs, path, res);
  });
  const bound = await listen(server, port);
  return wrap(server, bound);
}

/**
 * Serve the web player for a spec: `/` returns the player HTML (frames referenced
 * by relative path), and frame screenshots are served statically from `baseDir`.
 */
export async function servePlayer(spec: Spec, baseDir: string, port = 0): Promise<ServeHandle> {
  const abs = resolve(baseDir);
  const html = renderPlayerHtml(spec, { baseHref: "/", autoplay: true, title: spec.meta.title });
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(html);
      return;
    }
    void sendFile(abs, path, res);
  });
  const bound = await listen(server, port);
  return wrap(server, bound);
}
