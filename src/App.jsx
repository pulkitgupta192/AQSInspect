import { useState, useEffect } from "react";
import SetupScreen from "./SetupScreen";
import SettingsScreen from "./SettingsScreen";
import "./styles.css";


export default function App() {
  const [prUrl, setPrUrl] = useState("");
  const [token, setToken] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [prMeta, setPrMeta] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [unifiedDiff, setUnifiedDiff] = useState("");

  const [aiReview, setAiReview] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  
  const [config, setConfig] = useState(null);
  const [checkingConfig, setCheckingConfig] = useState(true);
  
  const [showSettings, setShowSettings] = useState(false);

	useEffect(() => {
	  (async () => {
		const savedConfig = await window.config.get();
		setConfig(savedConfig);
		setCheckingConfig(false);
	  })();
	}, []);

	if (checkingConfig) {
	  return <div className="loading">Loading…</div>;
	}

	if (!config) {
	  return <SetupScreen onSave={setConfig} />;
	}

	if (showSettings) {
	  return (
		<SettingsScreen
		  config={config}
		  onClose={() => setShowSettings(false)}
		  onConfigUpdated={(newConfig) => {
			setConfig(newConfig);
			setShowSettings(false);
		  }}
		  onReset={() => {
			setConfig(null);
			setShowSettings(false);
		  }}
		/>
	  );
	}

  /* ---------------- Fetch PR Diff ---------------- */
  const fetchDiff = async () => {
    setError(null);
    setPrMeta(null);
    setFiles([]);
    setSelectedFile(null);
    setUnifiedDiff("");
    setAiReview(null);

    if (!prUrl || !token) {
      setError("PR URL and GitHub Token are required");
      return;
    }

    try {
      setLoading(true);

      const result = await window.api.fetchPullRequestDiff({
        prUrl,
		token: config.token
      });

      setPrMeta(result.pr);
      setFiles(result.files || []);
      setSelectedFile(result.files?.[0] || null);
      setUnifiedDiff(result.unifiedDiff || "");
    } catch (e) {
      console.error("Fetch diff failed", e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- AI Review ---------------- */
  const runAiReview = async () => {
    if (!prMeta || (!unifiedDiff && !files.length)) {
      setError("No diff data available for AI review");
      return;
    }

    try {
      setAiLoading(true);
      setAiReview(null);

      const result = await window.api.reviewPullRequest({
        title: prMeta.title,
        unifiedDiff,
        files
      });

      setAiReview(result);
    } catch (e) {
      console.error("AI review failed", e);
      setError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="app-root">
      {/* ---------- Header ---------- */}
      <header className="header">
        <h2>AQS Inspect – PR Diff & AI Review</h2>

        <div className="controls">
          <input
            placeholder="GitHub Pull Request URL"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder="GitHub Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
		  <button className="settings-btn" onClick={() => setShowSettings(true)}>
			  ⚙ Settings
		  </button>

          <button onClick={fetchDiff} disabled={loading}>
            {loading ? "Fetching…" : "Fetch Diff"}
          </button>
        </div>

        {prMeta && (
          <div className="pr-meta">
            <strong>{prMeta.title}</strong> · {prMeta.state} ·{" "}
            {prMeta.changed_files} file(s)
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}

      {/* ---------- Diff Area ---------- */}
      <main className="diff-container">
        {/* File List */}
        <aside className="file-list">
          {files.map((file) => (
            <div
              key={file.filename}
              className={
                "file-item" +
                (selectedFile?.filename === file.filename ? " active" : "")
              }
              onClick={() => setSelectedFile(file)}
            >
              <span className={`status ${file.status}`}>
                {file.status?.[0]?.toUpperCase()}
              </span>
              <span className="filename">{file.filename}</span>
            </div>
          ))}
        </aside>

        {/* Patch Viewer */}
        <section className="patch-viewer">
          {selectedFile ? (
            <DiffPatch
				  patch={selectedFile.patch}
				  filename={selectedFile.filename}
				  findings={aiReview?.findings || []}
				/>
          ) : (
            <div className="empty">Select a file to view its diff</div>
          )}
        </section>
      </main>

      {/* ---------- AI Review Panel ---------- */}
      <section className="ai-panel">
        <button
          onClick={runAiReview}
          disabled={aiLoading || !files.length}
        >
          {aiLoading ? "Reviewing…" : "Generate AI Review"}
        </button>

        {aiReview?.findings?.length > 0 && (
          <>
            <h3>AI Review Results</h3>
            {aiReview.findings.map((f, idx) => (
              <div key={idx} className={`ai-card ${f.severity}`}>
                <strong>{f.title}</strong>
                <p>{f.explanation}</p>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

/* ---------------- Patch Renderer ---------------- */
function DiffPatch({ patch, filename, findings }) {
  if (!patch) {
    return <div className="empty">No diff available for this file</div>;
  }

  const fileFindings = findings.filter(
    (f) => f.filename === filename
  );

  return (
    <pre className="patch">
      {patch.split("\n").map((line, idx) => {
        let cls = "line";
        if (line.startsWith("+")) cls += " add";
        else if (line.startsWith("-")) cls += " del";
        else if (line.startsWith("@@")) cls += " hunk";

        const matchedFindings = fileFindings.filter(
          (f) => f.matchText && line.includes(f.matchText)
        );

        return (
          <div key={idx} className={cls}>
            {line}

            {matchedFindings.map((f, i) => (
              <InlineAnnotation key={i} finding={f} />
            ))}
          </div>
        );
      })}
    </pre>
  );
}

function InlineAnnotation({ finding }) {
  return (
    <div className={`inline-ai ${finding.severity}`}>
      <strong>{finding.title}</strong>
      <span>{finding.explanation}</span>
    </div>
  );
}