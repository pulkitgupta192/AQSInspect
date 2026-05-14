import { useState } from "react";

export default function SetupScreen({ onSave }) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState("");
  const [error, setError] = useState(null);

  const save = async () => {
    if (!token.trim()) {
      setError("GitHub token is required");
      return;
    }

    await window.config.save({ token, user });
    onSave({ token, user });
  };

  return (
    <div className="setup">
      <h2>Initial Setup</h2>

      <input
        type="password"
        placeholder="GitHub API Token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />

      <input
        placeholder="User (optional)"
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />

      {error && <div className="error">{error}</div>}

      <button onClick={save}>Save & Continue</button>
    </div>
  );
}