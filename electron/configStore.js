const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILE = path.join(
  app.getPath('userData'),
  'config.json'
);

/* =============================
   READ CONFIG
============================= */
function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (err) {
    console.error('❌ Failed to read config:', err);
    return {};
  }
}

/* =============================
   WRITE CONFIG
============================= */
function writeConfig(data) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Failed to write config:', err);
  }
}

/* =============================
   ✅ FULL MERGE SAVE (CRITICAL FIX)
============================= */
function saveConfig(newData) {
   try {
     const existing = readConfig();

    const merged = {
      ...existing,
      ...newData,

      // ✅ Deep merge blocks we’ll extend over time
      llm: { ...(existing.llm || {}), ...(newData.llm || {}) },
      github: { ...(existing.github || {}), ...(newData.github || {}) },
      azure: { ...(existing.azure || {}), ...(newData.azure || {}) },
    };

    // ✅ Migration-safe: keep legacy githubToken in sync
    // - If new github.token provided, also set githubToken
    if (merged.github?.token && !merged.githubToken) {
      merged.githubToken = merged.github.token;
    }
    // - If legacy githubToken exists but github.token absent, backfill github.token
    if (merged.githubToken && !merged.github?.token) {
      merged.github = { ...(merged.github || {}), token: merged.githubToken };
    }

    // ✅ Default repoType
    if (!merged.repoType) merged.repoType = "github";

     writeConfig(merged);

     return true;
   } catch (err) {
     console.error('❌ Failed to save config:', err);
     return false;
   }
 }

/* =============================
   EXPORTS
============================= */

/* ✅ Used by App + Settings */
exports.getConfig = () => readConfig();

/* ✅ Used by IPC */
exports.saveConfig = (data) => saveConfig(data);

/* ✅ Used by AI pipeline */
exports.getLLMConfig = () => {
  const config = readConfig();
  return config.llm || {};
};
