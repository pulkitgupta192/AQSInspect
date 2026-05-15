import { useEffect, useState } from "react";
import SetupScreen from "./SetupScreen";
import SettingsScreen from "./SettingsScreen";
import "./styles.css";

export default function App() {
  /* =============================
     STATE
  ============================= */
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [config, setConfig] = useState(null);
  const [checkingConfig, setCheckingConfig] = useState(true);

  const [showSettings, setShowSettings] = useState(false);

  const [prMeta, setPrMeta] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [unifiedDiff, setUnifiedDiff] = useState("");

  const [aiReview, setAiReview] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  /* =============================
     LOAD CONFIG
  ============================= */
  useEffect(() => {
    (async () => {
      const cfg = await window.api.getConfig();
      setConfig(cfg);
      setCheckingConfig(false);
    })();
  }, []);

  /* =============================
     INITIAL SCREENS
  ============================= */
  if (checkingConfig) {
    return <div style={{ padding: 20 }}>Loading...</div>;
  }

  if (!config?.githubToken) {
    return (
      <SetupScreen
        onConfigured={(newConfig) => setConfig(newConfig)}
      />
    );
  }

  if (showSettings) {
    return (
      <SettingsScreen
        onBack={() => setShowSettings(false)}
      />
    );
  }

  /* =============================
     FETCH PR DIFF
  ============================= */
  const fetchDiff = async () => {
    setError(null);
    setPrMeta(null);
    setFiles([]);
    setSelectedFile(null);
    setUnifiedDiff("");
    setAiReview(null);

    /* ✅ FIXED VALIDATION */
    if (!prUrl) {
      setError("PR URL is required");
      return;
    }

    if (!config?.githubToken) {
      setError(
        "GitHub Token is missing. Please configure it in Settings."
      );
      return;
    }

    try {
      setLoading(true);

      const result = await window.api.fetchPullRequestDiff({
        prUrl,
        token: config.githubToken
      });

      setPrMeta(result.pr);
      setFiles(result.files || []);
      setSelectedFile(result.files?.[0] || null);
      setUnifiedDiff(result.unifiedDiff || "");
    } catch (err) {
      console.error("Fetch diff failed", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /* =============================
     RUN AI REVIEW
  ============================= */
  const runAiReview = async () => {
    if (!unifiedDiff) {
      setError("No diff available for AI review");
      return;
    }

    try {
      setAiLoading(true);
      setAiReview(null);

      const result = await window.api.runAIReview({
        unifiedDiff,
        files
      });

      setAiReview(result);
    } catch (err) {
      console.error("AI review failed", err);
      setError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  /* =============================
     UI
  ============================= */
  return (
    <div className="app">
      {/* HEADER */}
      <div className="header">
        <h2>AQS Inspect – PR Diff & AI Review</h2>

        <button onClick={() => setShowSettings(true)}>
          ⚙ Settings
        </button>
      </div>

      {/* INPUT */}
      <div className="controls">
        <input
          placeholder="Enter GitHub PR URL"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
        />

        <button onClick={fetchDiff}>
          {loading ? "Fetching..." : "Fetch Diff"}
        </button>
      </div>

      {/* ERROR */}
      {error && <div className="error">{error}</div>}

      {/* PR META */}
      {prMeta && (
        <div className="pr-meta">
          <b>{prMeta.title}</b> · {prMeta.state} ·{" "}
          {prMeta.changed_files} file(s)
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="main">
        {/* FILE LIST */}
        <div className="file-list">
          {files.map((file, idx) => (
            <div
              key={idx}
              className={
                selectedFile?.filename === file.filename
                  ? "file active"
                  : "file"
              }
              onClick={() => setSelectedFile(file)}
            >
              {file.filename}
            </div>
          ))}
        </div>

        {/* DIFF VIEW */}
        <div className="diff-view">
          {selectedFile ? (
            <DiffPatch
              patch={selectedFile.patch}
              filename={selectedFile.filename}
              findings={aiReview?.findings || []}
            />
          ) : (
            <div>Select a file to view diff</div>
          )}
        </div>
      </div>

      {/* AI REVIEW PANEL */}
      {files.length > 0 && (
        <div className="ai-panel">
          <button onClick={runAiReview}>
            {aiLoading ? "Reviewing..." : "Generate AI Review"}
          </button>

          {aiReview && (
            <div className="ai-results">
              <h3>AI Review Summary</h3>
              <div>
                Score: <b>{aiReview.score}</b> | Severity:{" "}
                <b>{aiReview.severity}</b> | Confidence:{" "}
                <b>{aiReview.confidence}</b>
              </div>

              <h4>Findings</h4>
              {aiReview.findings?.map((f, i) => (
                <div key={i} className="finding">
                  <b>{f.title}</b>
                  <p>{f.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================
   DIFF PATCH COMPONENT
============================= */
function DiffPatch({ patch, filename, findings }) {
  if (!patch) return <div>No diff available</div>;

  const fileFindings = findings.filter(
    (f) => f.filename === filename
  );

  return (
    <pre>
      {patch.split("\n").map((line, idx) => {
        const matches = fileFindings.filter(
          (f) => f.matchText && line.includes(f.matchText)
        );

        return (
          <div key={idx}>
            {line}
            {matches.map((f, i) => (
              <div key={i} className="inline-finding">
                ⚠ {f.title}
              </div>
            ))}
          </div>
        );
      })}
    </pre>
  );
}
