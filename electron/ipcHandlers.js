const { ipcMain } = require("electron");

ipcMain.handle("app:ping", async () => "pong from main");

function parsePullRequestUrl(prUrl) {
  const u = new URL(prUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 4) throw new Error("Invalid PR URL format");

  const [owner, repo, pullWord, prNumStr] = parts;
  if (pullWord !== "pull" && pullWord !== "pulls") {
    throw new Error("PR URL must contain /pull/ or /pulls/");
  }
  const pull_number = Number(prNumStr);
  if (!Number.isFinite(pull_number)) throw new Error("Invalid PR number");

  const apiBase =
    u.hostname.toLowerCase() === "github.com"
      ? "https://api.github.com"
      : `${u.origin}/api/v3`;

  return { owner, repo, pull_number, apiBase };
}

// Accepts raw PAT or strings like "token: <PAT>" / "Token <PAT>" / "Bearer <PAT>"
function normalizeToken(input) {
  if (!input) return "";
  let t = String(input).trim();

  // strip common prefixes
  t = t.replace(/^token\s*:\s*/i, "");
  t = t.replace(/^toekn\s*:\s*/i, ""); // your typo case
  t = t.replace(/^bearer\s+/i, "");
  t = t.replace(/^token\s+/i, "");

  // if someone pasted a longer string containing github_pat_..., extract it
  const m = t.match(/github_pat_[A-Za-z0-9_]+/);
  if (m) t = m[0];

  return t.trim();
}

function makeHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "AQSInspect"
  };
}

async function githubGet(url, token, accept) {
  const res = await fetch(url, { headers: makeHeaders(token, accept) });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${bodyText || res.statusText}`);
  }
  return { res, bodyText };
}

function getNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",").map(s => s.trim());
  for (const p of parts) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function listAllPullFiles(apiBase, owner, repo, pull_number, token) {
  let url = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=100&page=1`;
  const all = [];
  while (url) {
    const { res, bodyText } = await githubGet(url, token);
    const page = JSON.parse(bodyText);
    if (Array.isArray(page)) all.push(...page);
    url = getNextLink(res.headers.get("link"));
  }
  return all;
}

ipcMain.handle("github:fetch-pr-diff", async (_evt, payload) => {
  const prUrl = payload?.prUrl;
  const token = normalizeToken(payload?.token);

  if (!prUrl) throw new Error("prUrl is required");
  if (!token) throw new Error("Valid GitHub token is required");

  const { owner, repo, pull_number, apiBase } = parsePullRequestUrl(prUrl);

  // PR metadata [1](https://docs.github.com/en/rest/pulls)
  const prApi = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}`;
  const { bodyText: prText } = await githubGet(prApi, token);
  const pr = JSON.parse(prText);

  // PR files (paginated) [1](https://docs.github.com/en/rest/pulls)
  const filesRaw = await listAllPullFiles(apiBase, owner, repo, pull_number, token);
  const files = filesRaw.map(f => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch || null
  }));

  // Unified diff (Accept header) [2](https://github.com/orgs/community/discussions/24460)
  let unifiedDiff = null;
  try {
    const { bodyText } = await githubGet(prApi, token, "application/vnd.github.v3.diff");
    unifiedDiff = bodyText;
  } catch {
    unifiedDiff = null;
  }

  return {
    ok: true,
    apiBase,
    pr: {
      owner,
      repo,
      number: pull_number,
      title: pr.title,
      state: pr.state,
      html_url: pr.html_url,
      head: { ref: pr.head?.ref, sha: pr.head?.sha },
      base: { ref: pr.base?.ref, sha: pr.base?.sha },
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions
    },
    filesCount: files.length,
    files,
    unifiedDiff
  };
});

ipcMain.handle("ai:review-pr", async (_, payload) => {
  const { title, unifiedDiff, files } = payload;

  // ---- STUBBED AI LOGIC (replace later with real LLM call) ----
  // This is intentionally deterministic + fast for now

  const findings = [];

  if (unifiedDiff?.includes("DELETE FROM") && !unifiedDiff?.includes("ROLLBACK")) {
    findings.push({
      severity: "critical",
      title: "Missing ROLLBACK on failure",
      explanation:
        "The script deletes from a parent table without ensuring a rollback in the exception block, risking partial data loss."
    });
  }

  if (unifiedDiff?.includes("/ v_order_count")) {
    findings.push({
      severity: "warning",
      title: "Potential divide by zero",
      explanation:
        "The logic divides by v_order_count without guarding against zero, which will throw a runtime error."
    });
  }

  if (unifiedDiff?.includes("DELETE FROM orders")) {
    findings.push({
      severity: "warning",
      title: "Referential integrity risk",
      explanation:
        "Deleting from ORDERS without checking dependent ORDER_ITEMS can break referential integrity."
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      title: "No major risks detected",
      explanation:
        "No obvious correctness, safety, or robustness issues were identified by static review."
    });
  }

  return {
    ok: true,
    summary: `AI review completed for PR: ${title}`,
    findings
  };
});