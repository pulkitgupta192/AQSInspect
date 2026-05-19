import { useEffect, useState } from "react";

export default function SettingsScreen({ onBack }) {
  /* =============================
     STATE
  ============================= */
  const [loading, setLoading] = useState(true);

  // Repo settings
  const [repoType, setRepoType] = useState("github");
  const [github, setGithub] = useState({ token: "", owner: "", repo: "", baseUrl: "" });
  const [azure, setAzure] = useState({ org: "", project: "", repoIdOrName: "", pat: "", baseUrl: "", apiVersion: "7.1" });

  // LLM settings
  const [provider, setProvider] = useState("azure");
  const [llm, setLLM] = useState({
    endpoint: "",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.2
  });

  const [verifyStatus, setVerifyStatus] = useState(null);
  const [llmStatus, setLlmStatus] = useState(null);

  /* =============================
     LOAD CONFIG
  ============================= */
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.api.getConfig();

        setRepoType(cfg?.repoType || "github");

        setGithub({
          token: cfg?.github?.token || cfg?.githubToken || "",
          owner: cfg?.github?.owner || "",
          repo: cfg?.github?.repo || "",
          baseUrl: cfg?.github?.baseUrl || ""
        });

        setAzure({
          org: cfg?.azure?.org || "",
          project: cfg?.azure?.project || "",
          repoIdOrName: cfg?.azure?.repoIdOrName || "",
          pat: cfg?.azure?.pat || "",
          baseUrl: cfg?.azure?.baseUrl || "",
          apiVersion: cfg?.azure?.apiVersion || "7.1"
        });

        if (cfg?.llm) {
          setLLM(cfg.llm);
          setProvider(cfg.llm.provider || "azure");
        }
      } catch (err) {
        console.error("Failed to load config", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* =============================
     VERIFY GITHUB TOKEN
  ============================= */
  const verifyToken = async () => {
    setVerifyStatus("Checking...");
    try {
      const result = await window.api.verifyGitHubToken(github.token);
      if (result.valid) {
        setVerifyStatus(`✅ Valid (User: ${result.username})`);
      } else {
        setVerifyStatus(`❌ ${result.error}`);
      }
    } catch (err) {
      setVerifyStatus("❌ Verification failed");
    }
  };

  /* =============================
     VERIFY LLM CONFIG
  ============================= */
  const verifyLLM = async () => {
    if (!llm?.apiKey) {
      setLlmStatus("❌ API key is missing");
      return;
    }

    if (provider === "azure" && !llm.endpoint) {
      setLlmStatus("❌ Azure endpoint required");
      return;
    }

    setLlmStatus("Checking...");

    try {
      const result = await window.api.verifyLLMConfig({ ...llm, provider });
      if (result.valid) {
        setLlmStatus("✅ LLM connection successful");
      } else {
        setLlmStatus(`❌ ${result.error}`);
      }
    } catch (err) {
      setLlmStatus("❌ Verification failed");
    }
  };

  /* =============================
     SAVE CONFIG
  ============================= */
  const saveConfig = async () => {
    try {
      setVerifyStatus(null);

      // Validate
      if (repoType === "github") {
        if (!github.token || !github.owner || !github.repo) {
          setVerifyStatus("❌ GitHub token + owner + repo are required");
          return;
        }
      }

      if (repoType === "azure") {
        if (!azure.org || !azure.project || !azure.repoIdOrName || !azure.pat) {
          setVerifyStatus("❌ Azure org + project + repo + PAT are required");
          return;
        }
      }

      await window.api.saveConfig({
        repoType,
        github: { ...github, baseUrl: github.baseUrl || undefined },
        azure: { ...azure, baseUrl: azure.baseUrl || undefined },

        // migration-safe legacy key
        githubToken: github.token,

        llm: { ...llm, provider }
      });

      alert("✅ Configuration saved");
    } catch (err) {
      console.error("Save failed", err);
      alert("❌ Failed to save config");
    }
  };

  if (loading) {
    return <div style={{ padding: 20 }}>Loading settings...</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Settings</h2>

      <button onClick={onBack}>⬅ Back</button>

      <hr />

      {/* =============================
          REPOSITORY
      ============================= */}
      <h3>Repository</h3>
      <select
        value={repoType}
        onChange={(e) => setRepoType(e.target.value)}
        style={{ width: "100%", padding: 8, marginTop: 6 }}
      >
        <option value="github">GitHub</option>
        <option value="azure">Azure DevOps</option>
      </select>

      <div style={{ marginTop: 12 }}>
        {repoType === "github" && (
          <>
            <h3 style={{ marginTop: 10 }}>GitHub Repository Settings</h3>

            <input
              type="password"
              placeholder="GitHub Token"
              value={github.token}
              onChange={(e) => setGithub({ ...github, token: e.target.value })}
              style={{ width: "100%" }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <input
                placeholder="Owner (org/user)"
                value={github.owner}
                onChange={(e) => setGithub({ ...github, owner: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                placeholder="Repo"
                value={github.repo}
                onChange={(e) => setGithub({ ...github, repo: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>

            <input
              placeholder="Base URL (optional, GitHub Enterprise)"
              value={github.baseUrl}
              onChange={(e) => setGithub({ ...github, baseUrl: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <div style={{ marginTop: 10 }}>
              <button onClick={verifyToken}>🔍 Verify Token</button>
              {verifyStatus && <span style={{ marginLeft: 10 }}>{verifyStatus}</span>}
            </div>
          </>
        )}

        {repoType === "azure" && (
          <>
            <h3 style={{ marginTop: 10 }}>Azure DevOps Repository Settings</h3>

            <div style={{ display: "flex", gap: 10 }}>
              <input
                placeholder="Organization"
                value={azure.org}
                onChange={(e) => setAzure({ ...azure, org: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                placeholder="Project"
                value={azure.project}
                onChange={(e) => setAzure({ ...azure, project: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>

            <input
              placeholder="Repository ID or Name"
              value={azure.repoIdOrName}
              onChange={(e) => setAzure({ ...azure, repoIdOrName: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <input
              type="password"
              placeholder="Azure DevOps PAT"
              value={azure.pat}
              onChange={(e) => setAzure({ ...azure, pat: e.target.value })}
              style={{ width: "100%", marginTop: 10 }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <input
                placeholder="Base URL (optional)"
                value={azure.baseUrl}
                onChange={(e) => setAzure({ ...azure, baseUrl: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                placeholder="API Version"
                value={azure.apiVersion}
                onChange={(e) => setAzure({ ...azure, apiVersion: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>

            {verifyStatus && <div style={{ marginTop: 10 }}>{verifyStatus}</div>}
          </>
        )}
      </div>

      <hr />

      {/* =============================
          LLM PROVIDER
      ============================= */}
      <h3>LLM Provider</h3>
      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
        <option value="azure">Azure OpenAI</option>
        <option value="openai">OpenAI (api.openai.com)</option>
      </select>

      <hr />

      {/* =============================
          LLM CONFIG
      ============================= */}
      <h3>LLM Configuration</h3>

      {provider === "azure" && (
        <input
          placeholder="Azure Endpoint"
          value={llm.endpoint}
          onChange={(e) => setLLM({ ...llm, endpoint: e.target.value })}
          style={{ width: "100%" }}
        />
      )}

      <input
        type="password"
        placeholder="API Key"
        value={llm.apiKey}
        onChange={(e) => setLLM({ ...llm, apiKey: e.target.value })}
        style={{ width: "100%", marginTop: 10 }}
      />

      <input
        placeholder="Model / Deployment Name"
        value={llm.model}
        onChange={(e) => setLLM({ ...llm, model: e.target.value })}
        style={{ width: "100%", marginTop: 10 }}
      />

      <input
        type="number"
        step="0.1"
        placeholder="Temperature"
        value={llm.temperature}
        onChange={(e) =>
          setLLM({
            ...llm,
            temperature: Number(e.target.value)
          })
        }
        style={{ width: "100%", marginTop: 10 }}
      />

      <div style={{ marginTop: 10 }}>
        <button onClick={verifyLLM}>🧪 Verify LLM</button>
        {llmStatus && <span style={{ marginLeft: 10 }}>{llmStatus}</span>}
      </div>

      <hr />

      {/* =============================
          SAVE
      ============================= */}
      <button onClick={saveConfig}>💾 Save Config</button>
    </div>
  );
}
