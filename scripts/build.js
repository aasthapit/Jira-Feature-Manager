// Fetches Jira issues and writes docs/board.json, grouped by label.
// Run with:  npm run build   (loads .env via node --env-file)
//
// Your API token stays local — only the resulting board.json is published.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "docs", "board.json");

const {
  JIRA_BASE_URL,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_JQL = "ORDER BY updated DESC",
  JIRA_MAX_ISSUES = "500",
} = process.env;

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  fail(
    "Missing config. Copy .env.example to .env and set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN."
  );
}

const baseUrl = JIRA_BASE_URL.replace(/\/+$/, "");
const maxIssues = Number.parseInt(JIRA_MAX_ISSUES, 10) || 500;
const authHeader =
  "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

const FIELDS = [
  "summary",
  "labels",
  "status",
  "assignee",
  "priority",
  "issuetype",
  "updated",
];

// Uses Jira Cloud's enhanced search endpoint (/search/jql) with token pagination.
async function fetchAllIssues() {
  const issues = [];
  let nextPageToken;

  do {
    const body = {
      jql: JIRA_JQL,
      fields: FIELDS,
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    };

    const res = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) fail("401 Unauthorized — check JIRA_EMAIL / JIRA_API_TOKEN.");
      if (res.status === 400) fail(`400 Bad Request — check your JQL.\n${text}`);
      fail(`Jira API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    issues.push(...(data.issues ?? []));
    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken && issues.length < maxIssues);

  return issues.slice(0, maxIssues);
}

function shapeIssue(issue) {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: f.summary ?? "(no summary)",
    status: f.status?.name ?? "Unknown",
    statusCategory: f.status?.statusCategory?.key ?? "undefined", // new | indeterminate | done
    issuetype: f.issuetype?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    assigneeAvatar: f.assignee?.avatarUrls?.["24x24"] ?? null,
    updated: f.updated ?? null,
    labels: f.labels ?? [],
    url: `${baseUrl}/browse/${issue.key}`,
  };
}

function buildColumns(issues) {
  const byLabel = new Map();
  const uncategorized = [];

  for (const issue of issues) {
    if (!issue.labels.length) {
      uncategorized.push(issue);
      continue;
    }
    for (const label of issue.labels) {
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(issue);
    }
  }

  const columns = [...byLabel.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ label, issues: byLabel.get(label) }));

  if (uncategorized.length) {
    columns.push({ label: "Uncategorized", uncategorized: true, issues: uncategorized });
  }
  return columns;
}

async function main() {
  console.log(`Fetching Jira issues from ${baseUrl} ...`);
  console.log(`JQL: ${JIRA_JQL}`);

  const raw = await fetchAllIssues();
  const issues = raw.map(shapeIssue);
  const columns = buildColumns(issues);

  const board = {
    generatedAt: new Date().toISOString(),
    jiraBaseUrl: baseUrl,
    jql: JIRA_JQL,
    totalIssues: issues.length,
    columns,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(board, null, 2));

  console.log(
    `\n✓ Wrote ${issues.length} issues across ${columns.length} column(s) to docs/board.json`
  );
  console.log("  Commit & push to update the published board.");
}

main().catch((err) => fail(err.stack || String(err)));
