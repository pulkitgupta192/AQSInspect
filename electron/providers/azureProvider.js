const { requestJson } = require("./http");
const { getCached, setCached } = require("./cache");

function authHeaderFromPat(pat) {
  // Basic base64(":"+PAT)
  const b64 = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${b64}`;
}

function mapAzureStatus(pr) {
  const st = (pr.status || "").toLowerCase();
  if (st === "active") return "open";
  if (st === "abandoned") return "closed";
  if (st === "completed") {
    // Prefer merged (Azure completed typically means merged)
    // If mergeStatus exists and indicates failure, treat as closed.
    const ms = (pr.mergeStatus || "").toLowerCase();
    if (ms && ms !== "succeeded") return "closed";
    return "merged";
  }
  return "closed";
}

async function listPullRequests({ filters, repoSettings }) {
  const org = repoSettings?.org;
  const project = repoSettings?.project;
  const repoIdOrName = repoSettings?.repoIdOrName;
  const pat = repoSettings?.pat;
  const baseUrl = repoSettings?.baseUrl || "https://dev.azure.com";
  const apiVersion = repoSettings?.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure settings are incomplete (org/project/repoIdOrName/pat required).");
  }

  const statusUi = (filters?.status || "all").toLowerCase();
  const statusMap = {
    open: "active",
    merged: "completed",
    closed: "abandoned",
  };

  const azureStatus = statusUi === "all" ? null : statusMap[statusUi] || null;

  const createdFrom = filters?.createdFrom;
  const createdTo = filters?.createdTo;

  const cacheKey = { provider: "azure", baseUrl, org, project, repoIdOrName, statusUi, createdFrom, createdTo, createdBy: filters?.createdBy || "" };
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const headers = {
    Authorization: authHeaderFromPat(pat),
    Accept: "application/json",
  };

  let all = [];
  let skip = 0;
  const top = 100;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("api-version", apiVersion);
    if (azureStatus) qs.set("searchCriteria.status", azureStatus);

    // Date range
    if (createdFrom) qs.set("searchCriteria.minTime", new Date(createdFrom).toISOString());
    if (createdTo) qs.set("searchCriteria.maxTime", new Date(createdTo).toISOString());
    if (createdFrom || createdTo) qs.set("searchCriteria.queryTimeRangeType", "Created");

    qs.set("$top", String(top));
    qs.set("$skip", String(skip));

    const url = `${baseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/pullrequests?${qs.toString()}`;

    const data = await requestJson(url, { headers });
    const items = data.value || [];
    all.push(...items);

    if (items.length < top) break;
    skip += top;
    if (skip > 5000) break; // safety
  }

  const createdByFilter = (filters?.createdBy || "").trim().toLowerCase();
  if (createdByFilter) {
    all = all.filter((pr) => {
      const name = (pr.createdBy?.displayName || pr.createdBy?.uniqueName || "").toLowerCase();
      return name.includes(createdByFilter);
    });
  }

  const norm = all.map((pr) => ({
    id: String(pr.pullRequestId),
    title: pr.title,
    url: pr._links?.web?.href || pr.url || "",
    createdAt: pr.creationDate,
    createdBy: pr.createdBy?.displayName || pr.createdBy?.uniqueName || "unknown",
    status: mapAzureStatus(pr),
  }));

  setCached(cacheKey, norm, 60_000);
  return norm;
}

async function getPullRequestDetails({ prUrlOrId, repoSettings }) {
  const org = repoSettings?.org;
  const project = repoSettings?.project;
  const repoIdOrName = repoSettings?.repoIdOrName;
  const pat = repoSettings?.pat;
  const baseUrl = repoSettings?.baseUrl || "https://dev.azure.com";
  const apiVersion = repoSettings?.apiVersion || "7.1";

  if (!org || !project || !repoIdOrName || !pat) {
    throw new Error("Azure settings are incomplete (org/project/repoIdOrName/pat required).");
  }

  let prId = prUrlOrId;
  if (typeof prUrlOrId === "string") {
	const m =
	  prUrlOrId.match(/pullrequest\/(\d+)/i) ||
	  prUrlOrId.match(/[?&]pullRequestId=(\d+)/i);
  
    if (m) prId = m[1];
  }
  if (!prId) throw new Error("PR id/url invalid.");

  const headers = { Authorization: authHeaderFromPat(pat) };
  const url = `${baseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoIdOrName)}/pullrequests/${encodeURIComponent(prId)}?api-version=${apiVersion}`;

  const pr = await requestJson(url, { headers });

  return {
    id: String(pr.pullRequestId),
    title: pr.title,
    url: pr._links?.web?.href || pr.url || "",
    createdAt: pr.creationDate,
    createdBy: pr.createdBy?.displayName || pr.createdBy?.uniqueName || "unknown",
    status: mapAzureStatus(pr),
  };
}

module.exports = { listPullRequests, getPullRequestDetails };