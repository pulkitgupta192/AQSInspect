const { requestJson } = require("./http");
const { getCached, setCached } = require("./cache");

function normalizeStatus(item, requestedStatus) {
  // For GitHub Search issues: open/closed.
  // If we queried is:merged, treat as merged.
  if (requestedStatus === "merged") return "merged";
  if (item.state === "open") return "open";
  return "closed";
}

function buildSearchQuery({ owner, repo }, filters) {
  const parts = [`repo:${owner}/${repo}`, "is:pr"];

  const status = (filters?.status || "all").toLowerCase();
  if (status === "open") parts.push("is:open");
  else if (status === "closed") parts.push("is:closed");
  else if (status === "merged") parts.push("is:merged");

  const createdFrom = filters?.createdFrom;
  const createdTo = filters?.createdTo;
  if (createdFrom || createdTo) {
    const from = createdFrom || "*";
    const to = createdTo || "*";
    parts.push(`created:${from}..${to}`);
  }

  if (filters?.createdBy?.trim()) {
    parts.push(`author:${filters.createdBy.trim()}`);
  }

  return parts.join(" ");
}

async function listPullRequests({ filters, repoSettings }) {
  const token = repoSettings?.token;
  const owner = repoSettings?.owner;
  const repo = repoSettings?.repo;
  const baseUrl = repoSettings?.baseUrl || "https://api.github.com";

  if (!token || !owner || !repo) {
    throw new Error("GitHub settings are incomplete (token/owner/repo required).");
  }

  const status = (filters?.status || "all").toLowerCase();
  const q = buildSearchQuery({ owner, repo }, filters);

  const cacheKey = { provider: "github", baseUrl, owner, repo, q };
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // GitHub Search Issues API
  const url = `${baseUrl}/search/issues?q=${encodeURIComponent(q)}&per_page=50&page=1`;

  const data = await requestJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const items = (data.items || []).map((it) => ({
    id: String(it.number),
    title: it.title,
    url: it.html_url,
    createdAt: it.created_at,
    createdBy: it.user?.login || "unknown",
    status: normalizeStatus(it, status),
  }));

  setCached(cacheKey, items, 60_000);
  return items;
}

async function getPullRequestDetails({ prUrlOrId, repoSettings }) {
  const token = repoSettings?.token;
  const owner = repoSettings?.owner;
  const repo = repoSettings?.repo;
  const baseUrl = repoSettings?.baseUrl || "https://api.github.com";

  if (!token || !owner || !repo) {
    throw new Error("GitHub settings are incomplete (token/owner/repo required).");
  }

  // Accept numeric id or full URL
  let number = prUrlOrId;
  if (typeof prUrlOrId === "string" && prUrlOrId.includes("/pull/")) {
    const m = prUrlOrId.match(/\/pull\/(\\d+)/);
    if (m) number = m[1];
  }
  if (!number) throw new Error("PR id/url invalid.");

  const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${number}`;
  const pr = await requestJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  return {
    id: String(pr.number),
    title: pr.title,
    url: pr.html_url,
    createdAt: pr.created_at,
    createdBy: pr.user?.login || "unknown",
    status: pr.state === "open" ? "open" : pr.merged_at ? "merged" : "closed",
  };
}

module.exports = { listPullRequests, getPullRequestDetails };