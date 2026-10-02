import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { config } from "./config.ts";
import { buildDashboard } from "./flags.ts";
import { runCheck } from "./pipeline.ts";
import { buildRootCauseReport, loadRcStore, runRootCauseCheck } from "./rootcause.ts";
import { SalesforceMcp } from "./salesforce.ts";
import { loadStore } from "./store.ts";
import { buildWorkload } from "./workload.ts";

const sf = new SalesforceMcp();
let running: Promise<unknown> | null = null;
let rcRunning: Promise<unknown> | null = null;
let nextRunAt = new Date();

function log(message: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

function triggerCheck(): boolean {
  if (running) return false;
  running = runCheck(sf, log)
    .catch((error) => log(`Unexpected failure: ${error}`))
    .finally(() => {
      running = null;
    });
  return true;
}

/** Runs separately so the first 30-day backfill never delays the sentiment check. */
function triggerRootCauseCheck(): boolean {
  if (rcRunning) return false;
  rcRunning = runRootCauseCheck(sf, log)
    .catch((error) => log(`Unexpected root cause failure: ${error}`))
    .finally(() => {
      rcRunning = null;
    });
  return true;
}

function scheduleNext() {
  const intervalMs = config.intervalMinutes * 60_000;
  nextRunAt = new Date(Date.now() + intervalMs);
  setTimeout(() => {
    if (!triggerCheck()) log("Previous check still running; skipping this interval.");
    if (!triggerRootCauseCheck()) log("Previous root cause check still running; skipping this interval.");
    scheduleNext();
  }, intervalMs);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      const body = { ...buildDashboard(loadStore()), running: running !== null, nextRunAt, intervalMinutes: config.intervalMinutes };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/workload") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(buildWorkload(loadStore())));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/rootcause") {
      const body = { ...buildRootCauseReport(loadRcStore(), rcRunning !== null), nextRunAt };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      const started = triggerCheck();
      const rcStarted = triggerRootCauseCheck();
      res.writeHead(started || rcStarted ? 202 : 409, { "content-type": "application/json" }).end(JSON.stringify({ started, rcStarted }));
      return;
    }
    const staticFiles: Record<string, [string, string]> = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/index.html": ["index.html", "text/html; charset=utf-8"],
      "/app.js": ["app.js", "text/javascript; charset=utf-8"],
      "/export.js": ["export.js", "text/javascript; charset=utf-8"],
      "/workload.js": ["workload.js", "text/javascript; charset=utf-8"],
      "/rootcause.js": ["rootcause.js", "text/javascript; charset=utf-8"],
    };
    const file = req.method === "GET" ? staticFiles[url.pathname] : undefined;
    if (file) {
      const body = await readFile(path.join(config.publicDir, file[0]));
      res.writeHead(200, { "content-type": file[1], "cache-control": "no-cache" }).end(body);
      return;
    }
    res.writeHead(404).end("Not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
  }
});

server.listen(config.port, "127.0.0.1", () => {
  log(`Dashboard: http://localhost:${config.port}  (checking every ${config.intervalMinutes} min)`);
  triggerCheck();
  triggerRootCauseCheck();
  scheduleNext();
});

async function shutdown() {
  server.close();
  await sf.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
