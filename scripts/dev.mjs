import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const clients = new Set();
let building = false,
  queued = false,
  debounce;
const notify = () => {
  for (const client of clients) client.write("data: reload\n\n");
};
async function build() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  try {
    const { stdout } = await run("npm", ["run", "build"], {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    notify();
  } catch (error) {
    console.error(error.stderr || error.message);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      await build();
    }
  }
}
// Complete the initial build before exposing the demo. No stale dist imports.
const initial = await run("npm", ["run", "build"], {
  cwd: root,
  maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(initial.stdout);
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/__dev/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    });
    response.write(": development reload connection\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/examples/") {
    response.writeHead(302, { Location: "/examples/index.html" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(url.pathname);
    const path = resolve(root, `.${pathname}`);
    if (
      !path.startsWith(root.endsWith(sep) ? root : root + sep) ||
      !["/examples/", "/dist/"].some((prefix) => pathname.startsWith(prefix))
    ) {
      response.writeHead(403).end();
      return;
    }
    let body = await readFile(path);
    const extension = extname(path);
    if (extension === ".html")
      body = Buffer.from(
        body
          .toString()
          .replace(
            "</body>",
            '<script>new EventSource("/__dev/events").onmessage = () => location.reload();</script></body>',
          ),
      );
    response.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".html": "text/html",
        ".json": "application/json",
        ".css": "text/css",
      }[extension] ?? "application/octet-stream",
    );
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Demo: http://127.0.0.1:${server.address().port}/examples/index.html (automatic rebuild/reload)`,
  ),
);
const watchers = [
  watch(resolve(root, "src"), { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(build, 150);
  }),
  watch(resolve(root, "examples"), { recursive: true }, () => notify()),
];
for (const file of ["tsup.config.ts", "package.json"])
  watchers.push(
    watch(resolve(root, file), () => {
      clearTimeout(debounce);
      debounce = setTimeout(build, 150);
    }),
  );
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearTimeout(debounce);
    for (const watcher of watchers) watcher.close();
    for (const client of clients) client.end();
    server.close();
  });
