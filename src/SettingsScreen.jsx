import { useState } from "react";

export default function SettingsScreen({
  config,
  onClose,
  onConfigUpdated,
  onReset
}) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(config?.user || "");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

	const verify = async () => {
	  if (!token.trim()) {
		setVerifyResult({
		  ok: false,
		  message: "Enter a token to verify"
		});
		return;
	  }

	  setVerifying(true);
	  setVerifyResult(null);

	  const result = await window.config.verifyToken(token);

	  setVerifyResult(result);
	  setVerifying(false);

	  if (result.ok && result.user) {
		setUser(result.user); // auto-fill user if valid
	  }
	};	

	{verifyResult && (
	  <div
		className={
		  verifyResult.ok ? "verify-success" : "verify-error"
		}
	  >
		{verifyResult.ok
		  ? `✅ Token is valid for user ${verifyResult.user}`
		  : `❌ ${verifyResult.message}`}
	  </div>
	)}	

  const save = async () => {
    if (!token.trim() && !user.trim()) {
      setError("Provide a new token or update user");
      return;
    }
	
	if (!verifyResult?.ok) {
	  setError("Please verify token before saving");
	  return;
	}	

    try {
      setSaving(true);

      const updatedConfig = {
        token: token.trim() || config.token,
        user
      };

      await window.config.save(updatedConfig);
      onConfigUpdated(updatedConfig);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    await window.config.clear();
    onReset();
  };

  return (
    <div className="settings-screen">
      <h2>Settings</h2>

      <label>User</label>
      <input
        value={user}
        onChange={(e) => setUser(e.target.value)}
        placeholder="GitHub username / email"
      />

      <label>GitHub Token</label>
      <input
        type="password"
        placeholder="Enter new token to replace existing one"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
	  
		<button onClick={verify} disabled={verifying}>
		  {verifying ? "Verifying…" : "Verify Token"}
		</button>


      {error && <div className="error">{error}</div>}

      <div className="settings-actions">
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>

        <button className="secondary" onClick={onClose}>
          Cancel
        </button>

        <button className="danger" onClick={reset}>
          Reset Setup
        </button>
      </div>
    </div>
  );
}