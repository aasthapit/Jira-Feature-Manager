// Local board server with Jira write-back.
//   npm run serve   →   http://localhost:8080
//
// Serves docs/ statically AND exposes a small write API that uses your .env
// token to update Jira labels when you drag a card. Because this runs on your
// machine, the token never reaches the browser and there's no CORS problem
// (Jira is called server-side). The public GitHub Pages site has no /api,
// so it stays read-only automatically.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "docs");
const PORT = Number.parseInt(process.env.PORT || "8080", 10);

const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
const jiraConfigured = Boolean(JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN);
const baseUrl = (JIRA_BASE_URL || "").replace(/\/+$/, "");
const authHeader = jiraConfigured
  ? "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")
  : null;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Apply a label change to a Jira issue: optionally remove one label, optionally add one.
async function updateLabels(issueKey, fromLabel, toLabel) {
  const ops = [];
  if (fromLabel) ops.push({ remove: fromLabel });
  if (toLabel) ops.push({ add: toLabel });
  if (!ops.length) return; // nothing to do

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ update: { labels: ops } }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Jira ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
}

function isValidLabel(v) {
  // Jira labels can't contain spaces.
  return typeof v === "string" && v.length > 0 && v.length <= 255 && !/\s/.test(v);
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health") {
    return sendJson(res, 200, { write: jiraConfigured, jiraBaseUrl: baseUrl || null });
  }

  if (pathname === "/api/move" && req.method === "POST") {
    if (!jiraConfigured) {
      return sendJson(res, 503, { error: "Jira not configured. Set values in .env." });
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body." });
    }

    const { issueKey } = payload;
    // null/undefined means "no label on this side" (e.g. Uncategorized).
    const fromLabel = payload.fromLabel || null;
    const toLabel = payload.toLabel || null;

    if (!issueKey || typeof issueKey !== "string") {
      return sendJson(res, 400, { error: "Missing issueKey." });
    }
    if (fromLabel && !isValidLabel(fromLabel)) {
      return sendJson(res, 400, { error: `Invalid fromLabel: ${fromLabel}` });
    }
    if (toLabel && !isValidLabel(toLabel)) {
      return sendJson(res, 400, { error: `Invalid label (no spaces allowed): ${toLabel}` });
    }
    if (fromLabel === toLabel) {
      return sendJson(res, 200, { ok: true, noop: true });
    }

    try {
      await updateLabels(issueKey, fromLabel, toLabel);
      console.log(`✓ ${issueKey}: ${fromLabel ?? "—"} → ${toLabel ?? "—"}`);
      return sendJson(res, 200, { ok: true, issueKey, fromLabel, toLabel });
    } catch (err) {
      console.error(`✗ ${issueKey}: ${err.message}`);
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  return sendJson(res, 404, { error: "Unknown API route." });
}

async function handleStatic(req, res, pathname) {
  try {
    let urlPath = pathname;
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

createServer(async (req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  } else {
    await handleStatic(req, res, pathname);
  }
}).listen(PORT, () => {
  console.log(`Board running at http://localhost:${PORT}`);
  console.log(
    jiraConfigured
      ? "Write mode: ON — drag cards to change Jira labels."
      : "Write mode: OFF — set JIRA_* in .env to enable editing."
  );
});
