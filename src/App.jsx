import { useEffect, useMemo, useRef, useState } from "react";
import SetupScreen from "./SetupScreen";
import SettingsScreen from "./SettingsScreen";
import "./styles.css";

/* -----------------------------
   Helpers: filename matching
------------------------------ */

const normPath = (p) => (p || "").replace(/\\/g, "/").trim();
const baseName = (p) => {
  const n = normPath(p);
  const parts = n.split("/");
  return parts[parts.length - 1] || n;
};
const fileMatches = (findingFile, filePath) => {
  if (!findingFile) return true; // allow “global” findings to attach by matchText
  const a = normPath(findingFile);
  const b = normPath(filePath);
  if (!a || !b) return false;
  if (a === b) return true;
  // common mismatch: finding provides basename only
  if (baseName(a) === baseName(b)) return true;
  // allow suffix match for partial paths
  return b.endsWith(a) || a.endsWith(b);
};

export default function App() {
  /* =============================
     Hooks (always called)
  ============================= */
  
  // PR Picker (multi-repo)
  const [repoType, setRepoType] = useState("github");
  const [filters, setFilters] = useState({
    createdFrom: "",
    createdTo: "",
    createdBy: "",
    status: "all",
  });
  const [prList, setPrList] = useState([]);
  const [prListLoading, setPrListLoading] = useState(false);
  const [selectedPrId, setSelectedPrId] = useState("");
  
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);

  const [config, setConfig] = useState(null);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [prMeta, setPrMeta] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [unifiedDiff, setUnifiedDiff] = useState("");

  const [aiReview, setAiReview] = useState(null);

  // filter + jump
  const [activeFilter, setActiveFilter] = useState("all"); // all|critical|warning|info
  const [issueIndex, setIssueIndex] = useState(0);
  const anchorsRef = useRef([]); // ordered DOM anchors for jump
  const anchorKeyToIndex = useRef(new Map()); // key -> index
  
  const loadPRs = async () => {
    setPrListLoading(true);
    setError(null);

    // quick client-side validation (avoid noisy main-process errors)
    if (repoType === "github") {
      const g = config?.github || {};
      const t = config?.githubToken || g.token;
      if (!t) {
        setPrListLoading(false);
        setError("GitHub Token is missing. Please configure it in Settings.");
        return;
      }
      if (!(g.owner && g.repo)) {
        setPrListLoading(false);
        setError("GitHub repository owner/repo are missing. Please configure Owner and Repo in Settings.");
        return;
      }
    }
    if (repoType === "azure") {
      const a = config?.azure || {};
      if (!(a.org && a.project && a.repoIdOrName && a.pat)) {
        setPrListLoading(false);
        setError("Azure DevOps settings are missing. Please configure org/project/repo/PAT in Settings.");
        return;
      }
    }

    try {
      const res = await window.api.listPullRequests({ repoType, filters });
      if (!res?.ok) {
        setError(res?.error || "Failed to load PRs");
        return;
      }
      setPrList(res.prs || []);
    } catch (e) {
      setError("Failed to load PRs");
    } finally {
      setPrListLoading(false);
    }
  };

  const onSelectPR = (id) => {
    setSelectedPrId(id);
    const pr = prList.find((p) => p.id === id);
    if (pr?.url) setPrUrl(pr.url); // ✅ auto-fill PR URL (still editable)
  };

  /* =============================
     Load config once
  ============================= */
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.api.getConfig();
        setConfig(cfg || {});
		setRepoType(cfg?.repoType || "github");
      } finally {
        setCheckingConfig(false);
      }
    })();
  }, []);

  /* =============================
     View mode (no early returns)
  ============================= */
  const viewMode = useMemo(() => {
    if (checkingConfig) return "loading";
    if (showSettings) return "settings";
    
	const needsSetup =
  repoType === "azure"
    ? !(config?.azure?.org && config?.azure?.project && config?.azure?.repoIdOrName && config?.azure?.pat)
    : !(config?.githubToken || config?.github?.token) || !(config?.github?.owner && config?.github?.repo)

	if (needsSetup) return "setup";
	
    return "main";
  }, [checkingConfig, showSettings, config?.githubToken, config?.azure, repoType]);

  /* =============================
     Derived: filtered findings
  ============================= */
  const filteredFindings = useMemo(() => {
    const all = aiReview?.findings || [];
    if (activeFilter === "all") return all;
    return all.filter((f) => (f.severity || "").toLowerCase() === activeFilter);
  }, [aiReview, activeFilter]);

  /* =============================
     Summary counts per file (robust match)
  ============================= */
  const fileSummary = useMemo(() => {
    const all = aiReview?.findings || [];
    const summary = {};
    for (const file of files) {
      const ff = all.filter((x) => fileMatches(x.filename, file.filename));
      summary[file.filename] = {
        critical: ff.filter((x) => (x.severity || "").toLowerCase() === "critical").length,
        warning: ff.filter((x) => (x.severity || "").toLowerCase() === "warning").length,
        info: ff.filter((x) => (x.severity || "").toLowerCase() === "info").length,
        total: ff.length
      };
    }
    return summary;
  }, [files, aiReview]);

  /* =============================
     Jump list keys (for counter)
  ============================= */
  const jumpCount = useMemo(() => {
    // This is purely informational; anchors are registered during render.
    return filteredFindings.length;
  }, [filteredFindings]);

  /* =============================
     Reset anchors when file/filter changes
  ============================= */
  useEffect(() => {
    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    setIssueIndex(0);
  }, [selectedFile?.filename, activeFilter]);

  /* =============================
     Actions
  ============================= */
  const fetchDiff = async () => {
    setError(null);
    setPrMeta(null);
    setFiles([]);
    setSelectedFile(null);
    setUnifiedDiff("");
    setAiReview(null);
    setActiveFilter("all");

    anchorsRef.current = [];
    anchorKeyToIndex.current = new Map();
    setIssueIndex(0);

    if (!prUrl) {
      setError("PR URL is required");
      return;
    }
    if (repoType === "github") {
      if (!config?.githubToken && !config?.github?.token) {
        setError("GitHub Token is missing. Please configure it in Settings.");
        return;
      }
    } else {
      const a = config?.azure || {};
      if (!(a.org && a.project && a.repoIdOrName && a.pat)) {
        setError("Azure DevOps settings are missing. Please configure org/project/repo/PAT in Settings.");
        return;
      }
    }

    try {
      setLoading(true);
	  const payload =
	  repoType === "github"
		  ? { prUrl, repoType, token: (config.githubToken || config.github?.token) }
		  : { prUrl: (selectedPrId || prUrl), repoType };
  
	  const result = await window.api.fetchPullRequestDiff(payload);


      setPrMeta(result.pr || null);
      setFiles(result.files || []);
      setSelectedFile((result.files && result.files[0]) || null);
      setUnifiedDiff(result.unifiedDiff || "");
    } catch (e) {
      console.error("Fetch diff failed:", e);
      setError(e.message || "Failed to fetch diff");
    } finally {
      setLoading(false);
    }
  };

  const runAiReview = async () => {
    setError(null);
    if (!unifiedDiff) {
      setError("No diff available for AI review");
      return;
    }

    try {
      setAiLoading(true);
      setAiReview(null);
      setActiveFilter("all");

      anchorsRef.current = [];
      anchorKeyToIndex.current = new Map();
      setIssueIndex(0);

      const res = await window.api.runAIReview({ unifiedDiff, files });

      // Normalize severity + ensure findings array
      const normalized = normalizeReview(res, files);
      setAiReview(normalized);
    } catch (e) {
      console.error("AI review failed:", e);
      setError(e.message || "AI review failed");
    } finally {
      setAiLoading(false);
    }
  };

  const goNextIssue = () => {
    const list = anchorsRef.current;
    if (!list.length) return;
    const next = (issueIndex + 1) % list.length;
    setIssueIndex(next);
    list[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const goPrevIssue = () => {
    const list = anchorsRef.current;
    if (!list.length) return;
    const prev = (issueIndex - 1 + list.length) % list.length;
    setIssueIndex(prev);
    list[prev]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* =============================
     Single Return (hooks safe)
  ============================= */
  return (
    <div className="app-shell">
      {viewMode === "loading" && <div className="page pad">Loading…</div>}

      {viewMode === "setup" && (
        <SetupScreen
          onConfigured={async () => {
            const cfg = await window.api.getConfig();
            setConfig(cfg || {});
			setRepoType(cfg?.repoType || "github");
          }}
        />
      )}

      {viewMode === "settings" && (
        <SettingsScreen
          onBack={async () => {
            const cfg = await window.api.getConfig();
            setConfig(cfg || {});
			setRepoType(cfg?.repoType || "github");
            setShowSettings(false);
          }}
        />
      )}

      {viewMode === "main" && (
        <>
          {/* Top App Bar */}
          <div className="topbar">
            <div className="topbar__title">
              <div className="brand">AQS Inspect</div>
              <div className="subtitle">PR Diff & AI Review</div>
            </div>

            <div className="topbar__actions">
              <button className="btn" onClick={() => setShowSettings(true)}>
                ⚙ Settings
              </button>
            </div>
          </div>

          {/* PR Controls */}
          {/* PR Controls */}
		  <div className="panel">
		  
		    {/* Repo + Filters */}
		    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
		  	<select
		  	  className="input"
		  	  style={{ maxWidth: 180 }}
		  	  value={repoType}
		  	  onChange={(e) => {
		  		setRepoType(e.target.value);
		  		setSelectedPrId("");
		  		setPrList([]);
		  	  }}
		  	>
		  	  <option value="github">GitHub</option>
		  	  <option value="azure">Azure DevOps</option>
		  	</select>
		  
		  	<input
		  	  className="input"
		  	  style={{ maxWidth: 160 }}
		  	  type="date"
		  	  value={filters.createdFrom}
		  	  onChange={(e) => setFilters((p) => ({ ...p, createdFrom: e.target.value }))}
		  	  title="Created from"
		  	/>
		  	<input
		  	  className="input"
		  	  style={{ maxWidth: 160 }}
		  	  type="date"
		  	  value={filters.createdTo}
		  	  onChange={(e) => setFilters((p) => ({ ...p, createdTo: e.target.value }))}
		  	  title="Created to"
		  	/>
		  
		  	<input
		  	  className="input"
		  	  style={{ minWidth: 180 }}
		  	  placeholder="Created by (user)"
		  	  value={filters.createdBy}
		  	  onChange={(e) => setFilters((p) => ({ ...p, createdBy: e.target.value }))}
		  	/>
		  
		  	<select
		  	  className="input"
		  	  style={{ maxWidth: 160 }}
		  	  value={filters.status}
		  	  onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
		  	  title="Status"
		  	>
		  	  <option value="all">All</option>
		  	  <option value="open">Open</option>
		  	  <option value="closed">Closed</option>
		  	  <option value="merged">Merged</option>
		  	</select>
		  
		  	<button className="btn" onClick={loadPRs} disabled={prListLoading}>
		  	  {prListLoading ? "Loading PRs…" : "Load PRs"}
		  	</button>
		    </div>
		  
		    {/* PR Picker */}
		    <div className="row" style={{ gap: 8, marginTop: 8 }}>
		  	<select
		  	  className="input"
		  	  value={selectedPrId}
		  	  onChange={(e) => onSelectPR(e.target.value)}
		  	>
		  	  <option value="">Select a PR…</option>
		  	  {prList.map((p) => (
		  		<option key={p.id} value={p.id}>
		  		  {`#${p.id} — ${String(p.title || "").slice(0, 90)}${String(p.title || "").length > 90 ? "…" : ""} (${p.status})`}
		  		</option>
		  	  ))}
		  	</select>
		  
		  	<button
		  	  className="btn"
		  	  onClick={() => {
		  		setSelectedPrId("");
		  		setPrUrl("");
		  	  }}
		  	  disabled={!selectedPrId && !prUrl}
		  	  title="Clear selection"
		  	>
		  	  Clear
		  	</button>
		    </div>
		  
		    {/* PR URL + existing workflow buttons */}
		    <div className="row" style={{ marginTop: 8 }}>
		  	<input
		  	  className="input"
		  	  placeholder="PR URL (auto-filled from picker, editable)"
		  	  value={prUrl}
		  	  onChange={(e) => setPrUrl(e.target.value)}
		  	/>
		  	<button className="btn primary" onClick={fetchDiff} disabled={loading}>
		  	  {loading ? "Fetching…" : "Fetch Diff"}
		  	</button>
		  	<button className="btn success" onClick={runAiReview} disabled={!files.length || aiLoading}>
		  	  {aiLoading ? "Reviewing…" : "Generate AI Review"}
		  	</button>
		    </div>
		  

            {error && <div className="error">{error}</div>}

            {/* KPI strip */}
            {prMeta && (
              <div className="kpis">
                <div className="kpi">
                  <div className="kpi__label">PR</div>
                  <div className="kpi__value">{prMeta.title || "-"}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__label">State</div>
                  <div className="kpi__value">{prMeta.state || "-"}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__label">Files</div>
                  <div className="kpi__value">{prMeta.changed_files ?? files.length}</div>
                </div>

                <div className="kpi kpi--right">
                  <div className="kpi__label">Score</div>
                  <div className="kpi__value">{aiReview?.score ?? "-"}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__label">Severity</div>
                  <div className="kpi__value">{aiReview?.severity ?? "-"}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__label">Confidence</div>
                  <div className="kpi__value">{aiReview?.confidence ?? "-"}</div>
                </div>
                <div className="kpi">
                  <div className="kpi__label">Findings</div>
                  <div className="kpi__value">{aiReview?.findings?.length ?? 0}</div>
                </div>
              </div>
            )}

            {/* Filter + Jump */}
            {aiReview && (
              <div className="toolbar">
                <div className="chips">
                  <button className={`chip ${activeFilter === "all" ? "active" : ""}`} onClick={() => setActiveFilter("all")}>
                    All
                  </button>
                  <button className={`chip ${activeFilter === "critical" ? "active" : ""}`} onClick={() => setActiveFilter("critical")}>
                    🔴 Critical
                  </button>
                  <button className={`chip ${activeFilter === "warning" ? "active" : ""}`} onClick={() => setActiveFilter("warning")}>
                    🟡 Warning
                  </button>
                  <button className={`chip ${activeFilter === "info" ? "active" : ""}`} onClick={() => setActiveFilter("info")}>
                    🟢 Info
                  </button>
                </div>

                <div className="jump">
                  <span className="muted">
                    {anchorsRef.current.length ? `${issueIndex + 1}/${anchorsRef.current.length}` : "0/0"}
                  </span>
                  <button className="btn" onClick={goPrevIssue} disabled={!anchorsRef.current.length}>
                    ⬆ Prev
                  </button>
                  <button className="btn" onClick={goNextIssue} disabled={!anchorsRef.current.length}>
                    ⬇ Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Main Layout */}
          <div className="workarea">
            {/* Sidebar */}
            <aside className="sidebar">
              <div className="sidebar__title">Files</div>
              {files.map((f) => {
                const stats = fileSummary[f.filename] || { critical: 0, warning: 0, info: 0, total: 0 };
                const active = selectedFile?.filename === f.filename;
                return (
                  <div
                    key={f.filename}
                    className={`file ${active ? "active" : ""}`}
                    onClick={() => setSelectedFile(f)}
                    title={f.filename}
                  >
                    <div className="file__name">{f.filename}</div>
                    <div className="file__badges">
                      {stats.critical > 0 && <span className="badge critical">🔴 {stats.critical}</span>}
                      {stats.warning > 0 && <span className="badge warning">🟡 {stats.warning}</span>}
                      {stats.info > 0 && <span className="badge info">🟢 {stats.info}</span>}
                      {stats.total === 0 && <span className="badge none">No issues</span>}
                    </div>
                  </div>
                );
              })}
            </aside>

            {/* Diff + Review */}
            <main className="main">
              <div className="diffpane">
                {selectedFile ? (
                  <SplitDiffViewer
                    file={selectedFile}
                    findings={filteredFindings}
                    activeIndex={issueIndex}
                    anchorsRef={anchorsRef}
                    anchorKeyToIndex={anchorKeyToIndex}
                  />
                ) : (
                  <div className="empty">Select a file to view diff</div>
                )}
              </div>

              {/* Always show review list (enterprise) */}
              <div className="reviewpane">
                <div className="reviewpane__title">Review Findings</div>
                {aiReview?.findings?.length ? (
                  aiReview.findings.map((f, idx) => (
                    <div key={idx} className={`reviewcard ${String(f.severity || "").toLowerCase()}`}>
                      <div className="reviewcard__hdr">
                        <span className="sev">{String(f.severity || "info").toUpperCase()}</span>
                        <span className="title">{f.title}</span>
                      </div>
                      <div className="reviewcard__body">{f.explanation}</div>
                      <div className="reviewcard__meta">
                        {f.filename ? <>File: <b>{f.filename}</b></> : <span className="muted">File: (not specified)</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted">No AI findings yet. Click “Generate AI Review”.</div>
                )}
              </div>
            </main>
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   Split Diff Viewer (paired rows + smart collapse + inline reviews)
========================================================= */
function SplitDiffViewer({ file, findings, activeIndex, anchorsRef, anchorKeyToIndex }) {
  const fileFindings = useMemo(() => {
    return (findings || []).filter((f) => fileMatches(f.filename, file.filename));
  }, [findings, file.filename]);

  const hunks = useMemo(() => splitIntoHunksUnified(file.patch || ""), [file.patch]);

  // collapse long context runs
  const COLLAPSE_THRESHOLD = 14;
  const KEEP_HEAD = 3;
  const KEEP_TAIL = 3;

  const [expandedFolds, setExpandedFolds] = useState(() => new Set());

  const toggleFold = (foldId) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(foldId)) next.delete(foldId);
      else next.add(foldId);
      return next;
    });
  };

  // reset anchor registry per render
  anchorsRef.current = [];
  anchorKeyToIndex.current = new Map();

  return (
    <div className="diff-surface">
      <div className="sticky file-header">{file.filename}</div>

      {hunks.map((h, hIdx) => {
        const paired = buildSplitRowsFromHunk(h.header, h.lines).map((r, idx) => ({ ...r, origIndex: idx }));

        const displayItems = buildSmartCollapsedItems(paired, hIdx, expandedFolds, {
          threshold: COLLAPSE_THRESHOLD,
          keepHead: KEEP_HEAD,
          keepTail: KEEP_TAIL
        });

        return (
          <div key={hIdx} className="hunk">
            <div className="sticky hunk-header">
              {h.header}
            </div>

            <div className="split-head">
              <div className="coltitle">Old</div>
              <div className="coltitle">New</div>
            </div>

            {displayItems.map((item, idx) => {
              if (item.type === "fold") {
                return (
                  <div key={`fold-${item.foldId}-${idx}`} className="fold-row">
                    <button className="fold-btn" onClick={() => toggleFold(item.foldId)}>
                      Show {item.count} unchanged lines
                    </button>
                  </div>
                );
              }

              const r = item.row;
              const joined = `${r.left || ""}\n${r.right || ""}`;

              // Inline matching: allow findings with missing filename too (global findings) by matchText
              const matched = fileFindings.filter((f) => f.matchText && joined.includes(f.matchText));

              // Render paired row
              return (
                <div key={`${hIdx}-${r.origIndex}`} className={`split-row ${r.kind}`}>
                  <div className="cell old">
                    <div className="ln">{r.oldNo ?? ""}</div>
                    <div className="code">{r.left || ""}</div>
                  </div>

                  <div className="cell neu">
                    <div className="ln">{r.newNo ?? ""}</div>
                    <div className="code">{r.right || ""}</div>
                  </div>

                  {/* Fix "distorted last line": render marker as its own full-width row */}
                  {r.noNewline && (
                    <div className="no-newline-row">\\ No newline at end of file</div>
                  )}

                  {/* Inline reviews */}
                  {matched.map((f, fIdx) => {
                    const anchorKey = `${file.filename}|${hIdx}|${r.origIndex}|${fIdx}`;
                    const anchorIndex = anchorsRef.current.length;

                    // register anchor
                    anchorKeyToIndex.current.set(anchorKey, anchorIndex);

                    return (
                      <div
                        key={anchorKey}
                        ref={(el) => {
                          if (el) anchorsRef.current[anchorIndex] = el;
                        }}
                        className={`inline-comment-row ${anchorIndex === activeIndex ? "issue-active" : ""}`}
                      >
                        <InlineComment finding={f} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function InlineComment({ finding }) {
  const sev = String(finding.severity || "info").toLowerCase();
  return (
    <div className={`inline-comment ${sev}`}>
      <div className="inline-hdr">
        <span className="sev">{sev.toUpperCase()}</span>
        <span className="ttl">{finding.title}</span>
      </div>
      <div className="inline-body">{finding.explanation}</div>
    </div>
  );
}

/* =========================================================
   Review normalization (client-side safety net)
========================================================= */
function normalizeReview(res, files) {
  const out = res && typeof res === "object" ? res : {};
  const findings = Array.isArray(out.findings) ? out.findings : [];

  // Normalize severities
  const sevMap = { high: "critical", medium: "warning", low: "info" };
  const normalizedFindings = findings.map((f) => {
    const raw = (f.severity || f.level || "").toString().toLowerCase();
    const sev = sevMap[raw] || (raw || "info");
    return {
      title: f.title || "Finding",
      explanation: f.explanation || f.details || "",
      severity: sev,
      filename: f.filename || f.file || "",
      matchText: f.matchText || f.match || ""
    };
  });

  // If filename empty and only 1 file changed, attach it (helps inline rendering)
  if (files?.length === 1) {
    normalizedFindings.forEach((f) => {
      if (!f.filename) f.filename = files[0].filename;
    });
  }

  return {
    score: out.score ?? 0,
    severity: out.severity ?? "",
    confidence: out.confidence ?? 0,
    findings: normalizedFindings
  };
}

/* =========================================================
   Production-grade diff pairing engine
========================================================= */
function parseHunkHeader(headerLine) {
  const m = headerLine.match(/@@\s+\-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return { oldStart: 1, newStart: 1 };
  return { oldStart: Number(m[1]), newStart: Number(m[3]) };
}

function splitIntoHunksUnified(patch) {
  const lines = String(patch || "").split("\n");
  const hunks = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
    } else {
      if (!current) current = { header: "(file header)", lines: [] };
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function buildSplitRowsFromHunk(hunkHeader, hunkLines) {
  const { oldStart, newStart } = parseHunkHeader(hunkHeader);
  let oldNo = oldStart;
  let newNo = newStart;

  const rows = [];
  let delBuf = [];
  let addBuf = [];

  const flush = () => {
    const pairCount = Math.min(delBuf.length, addBuf.length);

    for (let i = 0; i < pairCount; i++) {
      rows.push({ kind: "mod", left: delBuf[i].text, right: addBuf[i].text, oldNo: delBuf[i].no, newNo: addBuf[i].no });
    }
    for (let i = pairCount; i < delBuf.length; i++) {
      rows.push({ kind: "del", left: delBuf[i].text, right: "", oldNo: delBuf[i].no, newNo: null });
    }
    for (let i = pairCount; i < addBuf.length; i++) {
      rows.push({ kind: "add", left: "", right: addBuf[i].text, oldNo: null, newNo: addBuf[i].no });
    }

    delBuf = [];
    addBuf = [];
  };

  const markNoNewline = () => {
    const last = rows[rows.length - 1];
    if (last) last.noNewline = true;
  };

  for (const line of hunkLines) {
    if (line.startsWith("\\ No newline at end of file")) {
      flush();
      markNoNewline();
      continue;
    }

    const prefix = line[0];

    if (prefix === "-") {
      delBuf.push({ text: line, no: oldNo });
      oldNo += 1;
      continue;
    }
    if (prefix === "+") {
      addBuf.push({ text: line, no: newNo });
      newNo += 1;
      continue;
    }

    flush();

    if (prefix === " ") {
      rows.push({ kind: "ctx", left: line, right: line, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else {
      rows.push({ kind: "ctx", left: line, right: line, oldNo: null, newNo: null });
    }
  }

  flush();
  return rows;
}

function buildSmartCollapsedItems(rows, hunkIndex, expandedFolds, { threshold, keepHead, keepTail }) {
  const items = [];
  let i = 0;

  while (i < rows.length) {
    const r = rows[i];

    if (r.kind !== "ctx") {
      items.push({ type: "row", row: r });
      i++;
      continue;
    }

    let j = i;
    while (j < rows.length && rows[j].kind === "ctx") j++;
    const runLen = j - i;

    if (runLen <= threshold) {
      for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
    } else {
      const foldId = `${hunkIndex}-${i}-${j - 1}`;
      const expanded = expandedFolds.has(foldId);

      if (expanded) {
        for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
      } else {
        for (let k = i; k < i + keepHead; k++) items.push({ type: "row", row: rows[k] });
        items.push({ type: "fold", foldId, count: runLen - keepHead - keepTail });
        for (let k = j - keepTail; k < j; k++) items.push({ type: "row", row: rows[k] });
      }
    }

    i = j;
  }

  return items;
}
