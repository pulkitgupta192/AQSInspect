const { ipcMain, app } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { getProvider } = require("./providers"); // now resolves to electron/providers/index.js
const store = require("./configStore"); // exports.getConfig/getLLMConfig/saveLLMConfig in your current file

// -----------------------------
// Config persistence (FULL MERGE)
// -----------------------------
const CONFIG_FILE = path.join(app.getPath("userData"), "config.json");



function readConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (e) {
    console.error("❌ readConfigFile failed:", e.message);
    return {};
  }
}

function writeConfigFile(obj) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(obj, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("❌ writeConfigFile failed:", e.message);
    return false;
  }
}

function mergeConfig(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    llm: {
      ...(existing.llm || {}),
      ...(incoming.llm || {})
    }
  };
}

// -----------------------------
// Helpers
// -----------------------------
function normalizeToken(input) {
  if (!input) return "";
  let t = String(input).trim();
  t = t.replace(/^token\s*:\s*/i, "");
  t = t.replace(/^bearer\s+/i, "");
  t = t.replace(/^token\s+/i, "");
  const m = t.match(/github_pat_[A-Za-z0-9_]+/);
  if (m) t = m[0];
  return t.trim();
}

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

function getNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",").map((s) => s.trim());
  for (const p of parts) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();

  // direct JSON
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // strip ```json fences
  const fenced = trimmed.match(/```json([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  // find first {...}
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch (_) {}
  }

  return null;
}

function getLLMConfigSafe() {
  // Prefer your existing getLLMConfig if present
  if (typeof store.getLLMConfig === "function") return store.getLLMConfig();

  // fallback: read from config.json
  const cfg = readConfigFile();
  return cfg.llm || {};
}

function validateLLM(llm) {
  if (!llm?.apiKey) return "API key is missing";
  const provider = (llm.provider || "azure").toLowerCase();

  if (provider === "azure") {
    if (!llm.endpoint) return "Azure endpoint is missing";
    if (!llm.model) return "Azure deployment name (model) is missing";
  } else if (provider === "openai") {
    if (!llm.model) return "OpenAI model is missing";
  } else {
    return "Unknown provider. Use 'azure' or 'openai'.";
  }
  return null;
}

function getAxiosErrorMessage(error) {
  if (!error) return "Unknown network error";
  if (error.response?.data?.error?.message) return String(error.response.data.error.message);
  if (error.response?.data?.message) return String(error.response.data.message);
  if (error.message) return String(error.message);
  return String(error);
}

async function postWithRetry(url, body, headers, attempts = 3, initialDelay = 600) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await axios.post(url, body, { headers });
    } catch (e) {
      const status = e?.response?.status;
      const msg = getAxiosErrorMessage(e);
      const shouldRetry = status === 429 || status === 502 || status === 503 || status === 504;

      lastError = new Error(`LLM request failed (${status || "unknown"}): ${msg}`);

      if (shouldRetry && attempt < attempts) {
        const delay = initialDelay * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw lastError;
    }
  }
  throw lastError;
}

// -----------------------------
// IPC: App
// -----------------------------
ipcMain.handle("app:ping", async () => "pong from main");

// -----------------------------
// IPC: Config (the API your UI should use)
// -----------------------------
ipcMain.handle("config:get", async () => {
  // Your configStore.getConfig() reads the same config.json path; use it if available
  if (typeof store.getConfig === "function") return store.getConfig();
  return readConfigFile();
});

ipcMain.handle("config:save", async (_evt, data) => {
  const existing = readConfigFile();
  const merged = mergeConfig(existing, data || {});
  const ok = writeConfigFile(merged);
  return { ok };
});

ipcMain.handle("config:clear", async () => {
  try {
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Backward-compat: some older code in your repo used config:verify-token (kept)
ipcMain.handle("config:verify-token", async (_evt, token) => {
  const t = normalizeToken(token);
  if (!t) return { ok: false, message: "Token is required" };

  try {
    const res = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github+json"
      }
    });
    return { ok: true, user: res.data.login };
  } catch (e) {
    return { ok: false, message: e.response?.status === 401 ? "Invalid token" : e.message };
  }
});

// -----------------------------
// IPC: GitHub Token Verify (used by SettingsScreen.jsx)
// -----------------------------
ipcMain.handle("github:verify", async (_evt, token) => {
  const t = normalizeToken(token);
  if (!t) return { valid: false, error: "Token is required" };

  try {
    const res = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github+json"
      }
    });
    return { valid: true, username: res.data.login };
  } catch (e) {
    return { valid: false, error: e.response?.status === 401 ? "Invalid token" : e.message };
  }
});

ipcMain.handle("repo:listPullRequests", async (_evt, payload) => {
  const { repoType, filters } = payload || {};
  const cfg = store.getConfig ? store.getConfig() : {};

  const effectiveRepoType = (repoType || cfg.repoType || "github").toLowerCase();
  const repoSettings =
    effectiveRepoType === "azure"
      ? (cfg.azure || {})
      : (cfg.github || { token: cfg.githubToken });

  try {
    const provider = getProvider(effectiveRepoType);
    const prs = await provider.listPullRequests({ filters, repoSettings });
    return { ok: true, prs };
  } catch (e) {
    // No secrets logged
    console.error("listPullRequests failed:", e?.message || e);
    return {
      ok: false,
      error: "Failed to load pull requests. Please verify repository settings.",
    };
  }
});

ipcMain.handle("repo:getPullRequestDetails", async (_evt, payload) => {
  const { repoType, prUrlOrId } = payload || {};
  const cfg = store.getConfig ? store.getConfig() : {};

  const effectiveRepoType = (repoType || cfg.repoType || "github").toLowerCase();
  const repoSettings =
    effectiveRepoType === "azure"
      ? (cfg.azure || {})
      : (cfg.github || { token: cfg.githubToken });

  try {
    const provider = getProvider(effectiveRepoType);
    const pr = await provider.getPullRequestDetails({ prUrlOrId, repoSettings });
    return { ok: true, pr };
  } catch (e) {
    console.error("getPullRequestDetails failed:", e?.message || e);
    return { ok: false, error: "Failed to load PR details." };
  }
});

// -----------------------------
// IPC: Fetch PR Diff (canonical handler for your app)
// -----------------------------

// -----------------------------
// Azure DevOps diff implementation (PAT auth)
// -----------------------------
function isAzureDevOpsPrUrl(prUrl) {
  try {
    const u = new URL(prUrl);
    const h = (u.hostname || "").toLowerCase();
    return h.includes("dev.azure.com") || h.includes("visualstudio.com");
  } catch {
    return false;
  }
}

function parseAzurePullRequestId(prUrl) {
  // Supports:
  // - Web URL:  https://dev.azure.com/org/project/_git/repo/pullrequest/123
  // - API URL:  https://dev.azure.com/org/project/_apis/git/repositories/{repo}/pullRequests/123
  // - Query:    ...?pullRequestId=123
  // - Numeric:  "123"
  const s = String(prUrl || "").trim();
  if (!s) return null;

  // Numeric-only input
  if (/^\d+$/.test(s)) return s;

  // Web form
  let m = s.match(/pullrequest\/(\d+)/i);
  if (m) return m[1];

  // API form (Azure REST often returns this)
  m = s.match(/pullrequests\/(\d+)/i);
  if (m) return m[1];

  // Query param form
  m = s.match(/[?&]pullRequestId=(\d+)/i);
  if (m) return m[1];

  return null;
}

function azureAuthHeaderFromPat(pat) {
  // Basic base64(":" + PAT)
  const b64 = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${b64}`;
}

function stripLeadingSlash(p) {
  const s = String(p || "");
  return s.startsWith("/") ? s.slice(1) : s;
}

async function azureGetJson(url, headers) {
  const res = await axios.get(url, { headers });
  return res.data;
}

async function azureGetItemText({ apiRoot, path, commitId, apiVersion, headers }) {
  // Azure DevOps Git Items API supports includeContent=true when requesting json.
  const qs = new URLSearchParams();
  qs.set("path", path);
  qs.set("includeContent", "true");
  qs.set("$format", "json");
  qs.set("versionDescriptor.version", commitId);
  qs.set("versionDescriptor.versionType", "commit");
  qs.set("api-version", apiVersion);

  const url = `${apiRoot}/items?${qs.toString()}`;
  try {
    const res = await axios.get(url, { headers });
    const data = res.data;
    if (typeof data === "string") return data;
    if (data && typeof data.content === "string") return data.content;
    return "";
  } catch {
    // Deleted/binary files may not return content
    return "";
  }
}

// Minimal Myers diff for line arrays -> operations
function myersOps(aLines, bLines, maxTotalLines = 20000) {
  const a = Array.isArray(aLines) ? aLines : [];
  const b = Array.isArray(bLines) ? bLines : [];

  if (a.length + b.length > maxTotalLines) {
    return { ops: null, tooLarge: true };
  }

  const N = a.length;
  const M = b.length;
  const max = N + M;

  let v = new Map();
  v.set(1, 0);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      const vKMinus = v.get(k - 1);
      const vKPlus = v.get(k + 1);

      if (k === -d || (k !== d && (vKMinus ?? -1) < (vKPlus ?? -1))) {
        x = vKPlus ?? 0;
      } else {
        x = (vKMinus ?? 0) + 1;
      }

      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);

      if (x >= N && y >= M) {
        // Backtrack to build ops
        let bx = N;
        let by = M;
        const ops = [];

        for (let bd = trace.length - 1; bd >= 0; bd--) {
          const vv = trace[bd];
          const bk = bx - by;
          let prevK;

          if (bk === -bd || (bk !== bd && (vv.get(bk - 1) ?? -1) < (vv.get(bk + 1) ?? -1))) {
            prevK = bk + 1;
          } else {
            prevK = bk - 1;
          }

          const prevX = vv.get(prevK) ?? 0;
          const prevY = prevX - prevK;

          while (bx > prevX && by > prevY) {
            ops.push({ type: "equal", line: a[bx - 1] });
            bx--;
            by--;
          }

          if (bd === 0) break;

          if (bx === prevX) {
            ops.push({ type: "insert", line: b[by - 1] });
            by--;
          } else {
            ops.push({ type: "delete", line: a[bx - 1] });
            bx--;
          }
        }

        ops.reverse();
        return { ops, tooLarge: false };
      }
    }
  }

  return { ops: null, tooLarge: true };
}

function buildUnifiedPatchForFile(filePath, oldText, newText) {
  const oldLines = String(oldText ?? "").split(/\r?\n/);
  const newLines = String(newText ?? "").split(/\r?\n/);

  const { ops, tooLarge } = myersOps(oldLines, newLines);

  const p = stripLeadingSlash(filePath);
  const header = [
    `diff --git a/${p} b/${p}`,
    `--- a/${p}`,
    `+++ b/${p}`
  ];

  if (tooLarge || !ops) {
    const h = "@@ -1,0 +1,0 @@";
    const body = ["+[Large file diff omitted by AQS Inspect]"]; 
    return { patch: header.concat([h]).concat(body).join("\n"), additions: 0, deletions: 0 };
  }

  let additions = 0;
  let deletions = 0;
  const bodyLines = [];

  for (const op of ops) {
    if (op.type === "equal") bodyLines.push(" " + (op.line ?? ""));
    else if (op.type === "insert") {
      additions++;
      bodyLines.push("+" + (op.line ?? ""));
    } else if (op.type === "delete") {
      deletions++;
      bodyLines.push("-" + (op.line ?? ""));
    }
  }

  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const oldStart = oldCount === 0 ? 0 : 1;
  const newStart = newCount === 0 ? 0 : 1;
  const h = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

  return {
    patch: header.concat([h]).concat(bodyLines).join("\n"),
    additions,
    deletions
  };
}

async function fetchAzurePullRequestDiff({ prUrl, cfg }) {
  const prId = parseAzurePullRequestId(prUrl);
  if (!prId) throw new Error("Azure PR ID not found in URL");

  const a = cfg?.azure || {};
  const org = a.org;
  const project = a.project;
  const repoIdOrName = a.repoIdOrName;
  const pat = a.pat;
  const apiVersion = a.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure DevOps settings are incomplete (org/project/repo/PAT required). Please configure them in Settings.");
  }

  const baseUrlRaw = String(a.baseUrl || "https://dev.azure.com").trim().replace(/\/+$/, "");
  const orgRoot = baseUrlRaw.toLowerCase().endsWith("/" + org.toLowerCase())
    ? baseUrlRaw
    : `${baseUrlRaw}/${encodeURIComponent(org)}`;

  const apiRoot = `${orgRoot}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}`;
  const headers = {
    Authorization: azureAuthHeaderFromPat(pat),
    Accept: "application/json"
  };

  // PR details
  const prApiUrl = `${apiRoot}/pullRequests/${encodeURIComponent(prId)}?api-version=${encodeURIComponent(apiVersion)}`;
  const pr = await azureGetJson(prApiUrl, headers);

  const baseCommit = pr?.lastMergeTargetCommit?.commitId || pr?.lastMergeCommit?.commitId;
  const targetCommit = pr?.lastMergeSourceCommit?.commitId || pr?.lastMergeCommit?.commitId;

  if (!baseCommit || !targetCommit) {
    throw new Error("Unable to determine PR base/target commits from Azure DevOps response.");
  }

  // Diffs between commits: returns changed items list
  const diffQs = new URLSearchParams();
  diffQs.set("api-version", apiVersion);
  diffQs.set("baseVersion", baseCommit);
  diffQs.set("baseVersionType", "commit");
  diffQs.set("targetVersion", targetCommit);
  diffQs.set("targetVersionType", "commit");
  diffQs.set("$top", "2000");

  const diffsUrl = `${apiRoot}/diffs/commits?${diffQs.toString()}`;
  const diffs = await azureGetJson(diffsUrl, headers);
  const changes = Array.isArray(diffs?.changes) ? diffs.changes : [];

  const fileChanges = changes
    .map((c) => ({ path: c?.item?.path, changeType: c?.changeType || "edit" }))
    .filter((c) => typeof c.path === "string" && c.path && !c.path.endsWith("/"));

  const MAX_FILES = 60;
  const limited = fileChanges.slice(0, MAX_FILES);

  const files = [];
  let unifiedDiff = "";

  for (const ch of limited) {
    const filePath = ch.path;
    const ct = String(ch.changeType || "edit").toLowerCase();

    const oldText = ct.includes("add") ? "" : await azureGetItemText({ apiRoot, path: filePath, commitId: baseCommit, apiVersion, headers });
    const newText = ct.includes("delete") ? "" : await azureGetItemText({ apiRoot, path: filePath, commitId: targetCommit, apiVersion, headers });

    const { patch, additions, deletions } = buildUnifiedPatchForFile(filePath, oldText, newText);

    const fileObj = {
      filename: stripLeadingSlash(filePath),
      status: ct.includes("add") ? "added" : ct.includes("delete") ? "removed" : "modified",
      additions,
      deletions,
      changes: additions + deletions,
      patch
    };

    files.push(fileObj);
    unifiedDiff += (unifiedDiff ? "\n\n" : "") + patch;
  }

  const state = String(pr?.status || "").toLowerCase();

  return {
    ok: true,
    apiBase: apiRoot,
    pr: {
      org,
      project,
      repo: repoIdOrName,
      number: Number(prId),
      title: pr?.title,
      state,
      html_url: pr?._links?.web?.href || pr?.url || prUrl,
      changed_files: files.length,
      additions: files.reduce((s, f) => s + (f.additions || 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions || 0), 0)
    },
    filesCount: files.length,
    files,
    unifiedDiff
  };
}

async function listAllPullFiles(apiBase, owner, repo, pull_number, token) {
  let url = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=100&page=1`;
  const all = [];

  while (url) {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "AQSInspect"
      }
    });

    if (Array.isArray(res.data)) all.push(...res.data);
    const link = res.headers?.link;
    url = getNextLink(link);
  }

  return all;
}

ipcMain.handle("pr:fetchDiff", async (_evt, payload) => {
  const { prUrl, token, repoType } = payload || {};
  if (!prUrl) throw new Error("PR URL is required");

  const cfg = store.getConfig ? store.getConfig() : readConfigFile();
  const inferred = isAzureDevOpsPrUrl(prUrl) ? "azure" : "github";
  const effectiveRepoType = String(repoType || cfg?.repoType || inferred || "github").toLowerCase();

  if (effectiveRepoType === "azure") {
    return await fetchAzurePullRequestDiff({ prUrl, cfg });
  }

  // GitHub (existing behaviour)
  const t = normalizeToken(token || cfg?.githubToken || cfg?.github?.token);
  if (!t) throw new Error("GitHub Token is missing. Please configure it in Settings.");

  const { owner, repo, pull_number, apiBase } = parsePullRequestUrl(prUrl);
  const prApi = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}`;

  const prRes = await axios.get(prApi, {
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "AQSInspect"
    }
  });
  const pr = prRes.data;

  const filesRaw = await listAllPullFiles(apiBase, owner, repo, pull_number, t);
  const files = filesRaw.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch || null
  }));

  let unifiedDiff = "";
  try {
    const diffRes = await axios.get(prApi, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "AQSInspect"
      }
    });
    unifiedDiff = String(diffRes.data || "");
  } catch {
    unifiedDiff = files
      .map((f) => `diff --git a/${f.filename} b/${f.filename}
${f.patch || ""}`)
      .join("\n");
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
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions
    },
    filesCount: files.length,
    files,
    unifiedDiff
  };
});

// Backward compat: some earlier code used github:fetch-pr-diff
ipcMain.handle("github:fetch-pr-diff", async (_evt, payload) => {
  return ipcMain.emit ? await ipcMain.handle("pr:fetchDiff", _evt, payload) : await (async () => {
    // fallback: call same logic
    return await ipcMain._invokeHandler?.("pr:fetchDiff", _evt, payload);
  })();
});

// -----------------------------
// IPC: LLM Verify (Azure/OpenAI toggle)
// -----------------------------
ipcMain.handle("llm:verify", async (_evt, llmFromUi) => {
  const llm = llmFromUi || getLLMConfigSafe();
  const err = validateLLM(llm);
  if (err) return { valid: false, error: err };

  const provider = (llm.provider || "azure").toLowerCase();
  const temperature = typeof llm.temperature === "number" ? llm.temperature : 0.2;

  try {
    if (provider === "openai") {
      const res = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: llm.model,
          messages: [{ role: "user", content: "test" }],
          max_tokens: 5,
          temperature
        },
        {
          headers: {
            Authorization: `Bearer ${llm.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (res.status >= 200 && res.status < 300) return { valid: true };
      return { valid: false, error: `Unexpected status ${res.status}` };
    }

    // Azure
    const endpoint = String(llm.endpoint).replace(/\/$/, "");
    const apiVersion = llm.apiVersion || "2024-02-15-preview";
    const url = `${endpoint}/openai/deployments/${llm.model}/chat/completions?api-version=${apiVersion}`;

    const res = await axios.post(
      url,
      {
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5,
        temperature
      },
      {
        headers: {
          "api-key": llm.apiKey,
          "Content-Type": "application/json"
        }
      }
    );

    if (res.status >= 200 && res.status < 300) return { valid: true };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch (e) {
    return { valid: false, error: e.response?.data?.error?.message || e.message };
  }
});

// -----------------------------
// IPC: Full AI Review Pipeline (Azure/OpenAI)
// -----------------------------
ipcMain.handle("review:run", async (_evt, payload) => {
  const llm = getLLMConfigSafe();
  const err = validateLLM(llm);
  if (err) throw new Error(err);

  const provider = (llm.provider || "azure").toLowerCase();
  const temperature = typeof llm.temperature === "number" ? llm.temperature : 0.2;

  const unifiedDiff = payload?.unifiedDiff || "";
  if (!unifiedDiff) throw new Error("No diff provided for AI review.");

  // Improved system + user prompts for higher-quality, file-scoped reasoning
  const system = `You are an expert senior software engineer and AQS reviewer with deep knowledge of SQL/Oracle, IFS Applications and integration patterns. Always reason about security, performance, and maintainability. Where applicable, reference IFS documentation patterns and database best practices. Output MUST be JSON only.`;

  const user = `
Return JSON ONLY with this schema:
{
  "score": number (0-100),
  "severity": "LOW" | "MEDIUM" | "HIGH",
  "confidence": number (0-1),
  "findings": [
    { "title": string, "explanation": string, "filename": string, "matchText": string, "line": number }
  ],
  "fileReasoning": { "<filename>": "detailed reasoning text for the file" }
}

Provide per-file reasoning in 'fileReasoning' keyed by filename. For each finding, include the most-specific 'matchText' and an optional 'line' number if available. Use docs.ifs.com as primary guidance for IFS-specific recommendations when applicable. Analyze DIFF context below and synthesize findings per-file.

DIFF:
${unifiedDiff}
`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];

  let url;
  let headers;
  let body;

  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${llm.apiKey}`,
      "Content-Type": "application/json"
    };
    body = { model: llm.model, messages, temperature };
  } else {
    const endpoint = String(llm.endpoint).replace(/\/$/, "");
    const apiVersion = llm.apiVersion || "2024-02-15-preview";
    url = `${endpoint}/openai/deployments/${llm.model}/chat/completions?api-version=${apiVersion}`;
    headers = {
      "api-key": llm.apiKey,
      "Content-Type": "application/json"
    };
    body = { messages, temperature };
  }

  const res = await postWithRetry(url, body, headers, 3, 750);

  const content = res?.data?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);

  if (!parsed) {
    // graceful fallback, never crash UI
    return {
      score: 0,
      severity: "MEDIUM",
      confidence: 0.2,
      findings: [
        {
          title: "LLM returned non-JSON output",
          explanation: "The model response could not be parsed as JSON. Please retry with a smaller diff or different model.",
          filename: "",
          matchText: ""
        }
      ],
      raw: content
    };
  }

  return parsed;
});

// -----------------------------
// IPC: Generate Auto-Fix for a single finding (Azure/OpenAI)
// -----------------------------
ipcMain.handle("fix:generate", async (_evt, payload) => {
  const llm = getLLMConfigSafe();
  const err = validateLLM(llm);
  if (err) throw new Error(err);

  const provider = (llm.provider || "azure").toLowerCase();
  const temperature = typeof llm.temperature === "number" ? llm.temperature : 0.1;

  const filename = payload?.filename || "";
  const matchText = payload?.matchText || "";
  const title = payload?.title || "";
  const explanation = payload?.explanation || "";
  const filePatch = payload?.filePatch || "";       // the selected file's patch (preferred)
  const unifiedDiff = payload?.unifiedDiff || "";   // fallback context if needed

  if (!filename) throw new Error("filename is required");
  if (!filePatch && !unifiedDiff) throw new Error("No diff context provided");

  const system =
    "You are an expert IFS AQS code reviewer and fixer. Output MUST be JSON only. " +
    "Do not include markdown fences. Provide minimal, safe changes.";

  const user = `
Return JSON ONLY in this schema:
{
  "suggestedFix": string,
  "fixPatch": string,          // unified diff patch for the SAME file; may be empty if not possible safely
  "confidence": number (0-1),
  "notes": string              // any caveats or prerequisites
}

Context:
- File: ${filename}
- Finding title: ${title}
- Finding explanation: ${explanation}
- Match text (if any): ${matchText}

Diff context (prefer filePatch):
${filePatch || unifiedDiff}

Rules:
- Keep changes minimal and scoped.
- If you cannot safely generate a patch, return fixPatch as "" but still provide suggestedFix.
- Patch MUST be unified diff for this exact file path if provided.
`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let url, headers, body;
  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = { Authorization: `Bearer ${llm.apiKey}`, "Content-Type": "application/json" };
    body = { model: llm.model, messages, temperature };
  } else {
    const endpoint = String(llm.endpoint).replace(/\/$/, "");
    const apiVersion = llm.apiVersion || "2024-02-15-preview";
    url = `${endpoint}/openai/deployments/${llm.model}/chat/completions?api-version=${apiVersion}`;
    headers = { "api-key": llm.apiKey, "Content-Type": "application/json" };
    body = { messages, temperature };
  }

  const res = await axios.post(url, body, { headers });
  const content = res?.data?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);

  if (!parsed) {
    return {
      suggestedFix: "Unable to generate a structured fix. Try again or reduce diff size.",
      fixPatch: "",
      confidence: 0.2,
      notes: "LLM returned non-JSON output",
      raw: content,
    };
  }

  // ensure keys exist
  return {
    suggestedFix: String(parsed.suggestedFix || ""),
    fixPatch: String(parsed.fixPatch || ""),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    notes: String(parsed.notes || ""),
  };
});

// =============================// ================= Full File Content (GitHub + Azure DevOps)
// Exposes renderer API: window.api.getFileContent({ filename, side, repoType, prUrl, selectedPrId })
// side: "new" (latest/head) | "old" (base)
// =============================
ipcMain.handle("file:getContent", async (_evt, payload) => {
  const cfg = store.getConfig ? store.getConfig() : readConfigFile();

  const filename = String(payload?.filename || "").trim();
  const side = String(payload?.side || "new").toLowerCase(); // "new" | "old"
  const prUrl = String(payload?.prUrl || payload?.selectedPrId || "").trim();
  const repoTypeFromUi = String(payload?.repoType || "").toLowerCase();

  if (!filename) throw new Error("filename is required");
  if (!prUrl) throw new Error("prUrl (or selectedPrId) is required");

  // Infer repo type if not provided
  const inferredRepoType = isAzureDevOpsPrUrl(prUrl) ? "azure" : "github";
  const repoType = repoTypeFromUi || cfg?.repoType || inferredRepoType;

  // -------------------------
  // Azure DevOps
  // -------------------------
  if (repoType === "azure") {
    const a = cfg?.azure || {};
    const org = a.org;
    const project = a.project;
    const repoIdOrName = a.repoIdOrName;
    const pat = a.pat;
    const apiVersion = a.apiVersion || "7.1";

    if (!org || !project || !repoIdOrName || !pat) {
      throw new Error("Azure DevOps settings are incomplete (org/project/repo/PAT required).");
    }

    const prId = parseAzurePullRequestId(prUrl);
    if (!prId) throw new Error("Azure PR ID not found in URL");

    const baseUrlRaw = String(a.baseUrl || "https://dev.azure.com").trim().replace(/\/+$/, "");
    const orgRoot = baseUrlRaw.toLowerCase().endsWith("/" + org.toLowerCase())
      ? baseUrlRaw
      : `${baseUrlRaw}/${encodeURIComponent(org)}`;

    const apiRoot = `${orgRoot}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}`;

    const headers = {
      Authorization: azureAuthHeaderFromPat(pat),
      Accept: "application/json",
    };

    // PR details to get commit ids
    const prApiUrl = `${apiRoot}/pullRequests/${encodeURIComponent(prId)}?api-version=${encodeURIComponent(apiVersion)}`;
    const pr = await azureGetJson(prApiUrl, headers);

    const baseCommit =
      pr?.lastMergeTargetCommit?.commitId || pr?.lastMergeCommit?.commitId;
    const headCommit =
      pr?.lastMergeSourceCommit?.commitId || pr?.lastMergeCommit?.commitId;

    if (!baseCommit || !headCommit) {
      throw new Error("Unable to determine PR base/head commits from Azure DevOps response.");
    }

    const commitId = side === "old" ? baseCommit : headCommit;

    // Azure items API path must start with '/'
    const path = filename.startsWith("/") ? filename : `/${filename}`;

    const text = await azureGetItemText({
      apiRoot,
      path,
      commitId,
      apiVersion,
      headers,
    });

    return text || "";
  }

  // -------------------------
  // GitHub
  // -------------------------
  {
    // Token + repo info
    const t = normalizeToken(payload?.token || cfg?.githubToken || cfg?.github?.token);
    if (!t) throw new Error("GitHub Token is missing. Please configure it in Settings.");

    // Parse PR URL to get owner/repo/pr#
    const { owner, repo, pull_number, apiBase } = parsePullRequestUrl(prUrl);

    // Fetch PR details to get head/base SHA
    const prApi = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}`;
    const prRes = await axios.get(prApi, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "AQSInspect",
      },
    });
    const pr = prRes.data;

    const baseSha = pr?.base?.sha;
    const headSha = pr?.head?.sha;

    if (!baseSha || !headSha) throw new Error("Unable to determine PR base/head SHA from GitHub response.");

    const ref = side === "old" ? baseSha : headSha;

    // GitHub contents API needs URL-encoded path
    const encodedPath = encodeURIComponent(filename).replace(/%2F/g, "/");
    const contentUrl = `${apiBase}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

    const contentRes = await axios.get(contentUrl, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "AQSInspect",
      },
    });

    const data = contentRes.data;

    // If it's a file, GitHub returns base64 content
    if (data && data.type === "file" && data.content) {
      const buff = Buffer.from(String(data.content).replace(/\n/g, ""), "base64");
      return buff.toString("utf8");
    }

    // If GitHub returns something else (e.g. directory)
    throw new Error("GitHub returned non-file content (path may be a directory or missing).");
  }
});
