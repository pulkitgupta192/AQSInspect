const { ipcMain, app } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

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

// -----------------------------
// IPC: Fetch PR Diff (canonical handler for your app)
// -----------------------------
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

ipcMain.handle("pr:fetchDiff", async (_evt, { prUrl, token }) => {
  const t = normalizeToken(token);
  if (!prUrl) throw new Error("PR URL is required");
  if (!t) throw new Error("GitHub Token is missing. Please configure it in Settings.");

  const { owner, repo, pull_number, apiBase } = parsePullRequestUrl(prUrl);
  const prApi = `${apiBase}/repos/${owner}/${repo}/pulls/${pull_number}`;

  // PR metadata
  const prRes = await axios.get(prApi, {
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "AQSInspect"
    }
  });
  const pr = prRes.data;

  // files (paginated)
  const filesRaw = await listAllPullFiles(apiBase, owner, repo, pull_number, t);
  const files = filesRaw.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch || null
  }));

  // unified diff
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
      .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch || ""}`)
      .join("\n\n");
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

  const system = "You are an expert IFS AQS code reviewer. Output MUST be JSON only.";
  const user = `
Return JSON ONLY in this schema:
{
  "score": number (0-100),
  "severity": "LOW" | "MEDIUM" | "HIGH",
  "confidence": number (0-1),
  "findings": [
    { "title": string, "explanation": string, "filename": string, "matchText": string }
  ]
}

Analyze this diff with IFS AQS mindset (IFS Apps8/9/10 and IFS Cloud, Aurena safe patterns):
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

  const res = await axios.post(url, body, { headers });

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
