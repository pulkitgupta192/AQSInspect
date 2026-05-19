const githubProvider = require("./githubProvider");
const azureProvider = require("./azureProvider");

function getProvider(repoType) {
  const t = (repoType || "github").toLowerCase();
  if (t === "azure") return azureProvider;
  return githubProvider;
}

module.exports = { getProvider };