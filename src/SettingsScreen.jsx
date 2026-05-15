import { useEffect, useState } from "react";

export default function SettingsScreen({ onBack }) {
  /* =============================
     STATE
  ============================= */
  const [provider, setProvider] = useState("azure");

  const [githubToken, setGithubToken] = useState("");

  const [llm, setLLM] = useState({
    endpoint: "",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.2
  });

  const [verifyStatus, setVerifyStatus] = useState(null);
  const [llmStatus, setLlmStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  /* =============================
     LOAD CONFIG
  ============================= */
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.api.getConfig();

        if (cfg?.githubToken) {
          setGithubToken(cfg.githubToken);
        }

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
      const result = await window.api.verifyGitHubToken(githubToken);

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
      const result = await window.api.verifyLLMConfig({
        ...llm,
        provider
      });

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
      await window.api.saveConfig({
        githubToken,
        llm: {
          ...llm,
          provider
        }
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

  /* =============================
     UI
  ============================= */
  return (
    <div style={{ padding: 20 }}>
      <h2>Settings</h2>

      {/* ✅ BACK BUTTON */}
      <button onClick={onBack}>⬅ Back</button>

      <hr />

      {/* =============================
          GITHUB CONFIG
      ============================= */}
      <h3>GitHub Configuration</h3>

      <input
        type="password"
        placeholder="GitHub Token"
        value={githubToken}
        onChange={(e) => setGithubToken(e.target.value)}
        style={{ width: "100%" }}
      />

      <div style={{ marginTop: 10 }}>
        <button onClick={verifyToken}>🔍 Verify Token</button>
        {verifyStatus && (
          <span style={{ marginLeft: 10 }}>{verifyStatus}</span>
        )}
      </div>

      <hr />

      {/* =============================
          LLM PROVIDER
      ============================= */}
      <h3>LLM Provider</h3>

      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
      >
        <option value="azure">Azure OpenAI</option>
        <option value="openai">OpenAI (api.openai.com)</option>
      </select>

      <hr />

      {/* =============================
          LLM CONFIG
      ============================= */}
      <h3>LLM Configuration</h3>

      {/* ✅ Only show endpoint for Azure */}
      {provider === "azure" && (
        <input
          placeholder="Azure Endpoint"
          value={llm.endpoint}
          onChange={(e) =>
            setLLM({ ...llm, endpoint: e.target.value })
          }
          style={{ width: "100%" }}
        />
      )}

      <input
        type="password"
        placeholder="API Key"
        value={llm.apiKey}
        onChange={(e) =>
          setLLM({ ...llm, apiKey: e.target.value })
        }
        style={{ width: "100%", marginTop: 10 }}
      />

      <input
        placeholder="Model / Deployment Name"
        value={llm.model}
        onChange={(e) =>
          setLLM({ ...llm, model: e.target.value })
        }
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
        {llmStatus && (
          <span style={{ marginLeft: 10 }}>{llmStatus}</span>
        )}
      </div>

      <hr />

      {/* =============================
          SAVE
      ============================= */}
      <button onClick={saveConfig}>💾 Save Config</button>
    </div>
  );
}
