# Jira Feature Manager

A Trello-style board for tracking feature-level tasks, **grouped into columns by Jira label**.
The board is a static site served from GitHub Pages. A local build script pulls issues from
the Jira REST API and writes `docs/board.json` — your API token never leaves your machine and
is never committed.

```
Jira  ──(npm run build, uses .env token)──▶  docs/board.json  ──(git push)──▶  GitHub Pages
```

## How it works

- **Columns = Jira labels.** Each label becomes a column; an issue with multiple labels appears
  in each. Issues with no labels go to an **Uncategorized** column.
- **Manual refresh.** You run `npm run build` whenever you want fresh data, then commit & push.
- **No secrets in the browser.** Only `board.json` (issue keys, summaries, statuses) is published.

## One-time setup

1. **Create a Jira API token:** https://id.atlassian.com/manage-profile/security/api-tokens

2. **Configure credentials:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and your `JIRA_JQL`.

3. **Generate the board:**
   ```bash
   npm run build
   ```

4. **Preview locally (optional):**
   ```bash
   npm run serve     # http://localhost:8080
   ```

## Editing labels by drag-and-drop (local only)

When you run `npm run serve`, the board runs in **edit mode**:

- **Drag a card** from one column to another. On drop, the local server calls Jira to
  **remove the source column's label** and **add the target column's label** on that issue.
- **Add a column** with the "+ Column" box (top right). Type a label name (no spaces) and
  drop a card onto it — Jira creates the label automatically.
- **Uncategorized** is the "no label" bucket: dropping *onto* it just removes the source
  label; dragging *out of* it just adds the target label.
- A green **● Edit mode** badge confirms write-back is active.

This only works locally because your Jira token lives in `.env` on your machine. The public
GitHub Pages site has no write API, so it automatically stays a **read-only** view (no badge,
no dragging). After making changes, run `npm run build` again to re-sync the board with Jira,
then commit & push to update the published view.

> Drag-to-relabel changes labels immediately in Jira, but the *board JSON* only refreshes when
> you run `npm run build`. So locally the card moves optimistically; re-build to reconcile.

## Publishing to GitHub Pages

1. Create a repo on GitHub and push this folder (see commands below).
2. In the repo: **Settings → Pages**.
3. Set **Source = Deploy from a branch**, **Branch = `main`**, **Folder = `/docs`**. Save.
4. Your board will be live at `https://<your-username>.github.io/<repo-name>/`.

> Note: free GitHub Pages requires a **public** repo, so `board.json` is publicly readable.
> Your Jira token is in `.env` (gitignored) and is never exposed. If the issue data must stay
> private, use a private repo with GitHub Pages (requires GitHub Pro).

## Updating the board

```bash
npm run build
git add docs/board.json
git commit -m "Refresh board"
git push
```

## Customizing

- **Which issues appear:** edit `JIRA_JQL` in `.env`
  (e.g. `project = FEAT AND statusCategory != Done`).
- **Card fields & colors:** `docs/app.js` and `docs/styles.css`.
- **What defines a column:** grouping logic lives in `buildColumns()` in `scripts/build.js`.
