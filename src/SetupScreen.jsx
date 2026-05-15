import { useState } from "react";

export default function SetupScreen({ onConfigured }) {
  const [githubToken, setGithubToken] = useState("");

  const save = async () => {
    try {
      if (!githubToken) {
        alert("GitHub token is required");
        return;
      }

      /* ✅ FIX: use window.api instead of window.config */
      await window.api.saveConfig({
        githubToken
      });

      const newConfig = await window.api.getConfig();

      onConfigured(newConfig);
    } catch (err) {
      console.error("Setup failed:", err);
      alert("Failed to save configuration");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Initial Setup</h2>

      <input
        type="password"
        placeholder="Enter GitHub Token"
        value={githubToken}
        onChange={(e) => setGithubToken(e.target.value)}
        style={{ width: "100%" }}
      />

      <br /><br />

      <button onClick={save}>✅ Save & Continue</button>
    </div>
  );
}
