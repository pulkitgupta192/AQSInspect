import React, { useEffect, useMemo, useRef, useState } from "react";

const COLLAPSE_THRESHOLD = 14;
const KEEP_HEAD = 3;
const KEEP_TAIL = 3;

const isLargeOmitted = (patch = "") => {
  const p = String(patch || "");
  return (
    !p.trim() ||
    p.includes("[Large file diff omitted by AQS Inspect]") ||
    p.toLowerCase().includes("large file diff omitted")
  );
};

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
      rows.push({
        kind: "mod",
        left: delBuf[i].text,
        right: addBuf[i].text,
        oldNo: delBuf[i].no,
        newNo: addBuf[i].no,
      });
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
      delBuf.push({ text: line, no: oldNo++ });
      continue;
    }

    if (prefix === "+") {
      addBuf.push({ text: line, no: newNo++ });
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

function buildSmartCollapsedItems(rows, hunkIndex, expandedFolds) {
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

    if (runLen <= COLLAPSE_THRESHOLD) {
      for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
    } else {
      const foldId = `${hunkIndex}-${i}-${j - 1}`;
      const expanded = expandedFolds.has(foldId);

      if (expanded) {
        for (let k = i; k < j; k++) items.push({ type: "row", row: rows[k] });
      } else {
        for (let k = i; k < i + KEEP_HEAD; k++) items.push({ type: "row", row: rows[k] });
        items.push({ type: "fold", foldId, count: runLen - KEEP_HEAD - KEEP_TAIL });
        for (let k = j - KEEP_TAIL; k < j; k++) items.push({ type: "row", row: rows[k] });
      }
    }

    i = j;
  }

  return items;
}

function extractAddedFileContentFromPatch(patch) {
  const lines = String(patch || "").split("\n");
  const out = [];
  for (const l of lines) {
    if (l.startsWith("diff --git") || l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("@@")) continue;
    if (l.startsWith("+")) out.push(l.slice(1));
    else if (l.startsWith(" ")) out.push(l.slice(1));
  }
  return out.join("\n");
}

const normalize = (s = "") =>
  String(s || "")
    .replace(/^[+-]/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function InlineComment({ finding }) {
  const sev = String(finding?.severity || "info").toLowerCase();
  return (
    <div className={`inline-comment ${sev}`}>
      <div className="inline-hdr">
        <span className="sev">{sev.toUpperCase()}</span>
        <span className="ttl">{finding?.title || "Finding"}</span>
      </div>
      <div className="inline-body">{finding?.explanation || ""}</div>
    </div>
  );
}

/**
 * ✅ DiffViewer (Final)
 * - Auto-loads full file when diff is truncated/omitted
 * - Keeps existing modes, folding, and twin horizontal scrollbars
 */
export default function DiffViewer({ file, findings = [], onRequestFullFile }) {
  const [mode, setMode] = useState("modified"); // inline | side | modified
  const [expandedFolds, setExpandedFolds] = useState(() => new Set());

  const surfaceRef = useRef(null);
  const oldBarRef = useRef(null);
  const newBarRef = useRef(null);
  const toolbarRef = useRef(null);

  const [scrollMetrics, setScrollMetrics] = useState({ oldMax: 0, newMax: 0, oldViewport: 0, newViewport: 0 });

  const [showFull, setShowFull] = useState(false);
  const [fullText, setFullText] = useState("");
  const [fullLoading, setFullLoading] = useState(false);
  const [fullError, setFullError] = useState("");
  const [fullScreenMode, setFullScreenMode] = useState(false);
  const [modeDropdown, setModeDropdown] = useState(false);

  // ✅ Auto-load state (prevents repeated auto fetch)
  const autoLoadedKeyRef = useRef(""); // stores `${filename}::${side}` for last auto-load
  const [autoLoaded, setAutoLoaded] = useState(false);

  const patch = file?.patch || "";
  const status = String(file?.status || "modified").toLowerCase();
  const omitted = status !== "added" && isLargeOmitted(patch);

  // Default mode like Azure:
  // - added → inline content
  // - else → modified mode
  useEffect(() => {
    if (!file) return;
    if (status === "added") setMode("inline");
    else setMode("modified");
    setExpandedFolds(new Set());

    // reset full panel state when file changes
    setShowFull(false);
    setFullText("");
    setFullError("");
    setFullLoading(false);

    // reset auto flag for new file
    setAutoLoaded(false);
  }, [file?.filename]); // eslint-disable-line react-hooks/exhaustive-deps

  const hunks = useMemo(() => splitIntoHunksUnified(patch), [patch]);

  const findingsForFile = useMemo(() => {
    const fname = String(file?.filename || "");
    return (findings || []).filter((f) => !f?.filename || String(f.filename) === fname);
  }, [findings, file?.filename]);

  const findingsCount = findingsForFile.length;

  const toggleFold = (foldId) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(foldId)) next.delete(foldId);
      else next.add(foldId);
      return next;
    });
  };

  const applyOldX = (x) => surfaceRef.current?.style?.setProperty("--oldX", String(x || 0));
  const applyNewX = (x) => surfaceRef.current?.style?.setProperty("--newX", String(x || 0));

  const requestFullLatest = async (side = "new", { forceOpen = true } = {}) => {
    setFullError("");
    setFullLoading(true);
    setFullText("");

    if (forceOpen) setShowFull(true);

    try {
      if (!onRequestFullFile) throw new Error("Full file API not wired (onRequestFullFile is missing).");
      const txt = await onRequestFullFile(file, side);
      setFullText(txt || "");
    } catch (e) {
      setFullError(e?.message || "Failed to load full file");
    } finally {
      setFullLoading(false);
    }
  };

  /**
   * ✅ AUTO LOAD: if diff is omitted/truncated, auto-fetch the full file once.
   * - removed files → base (old)
   * - others → latest (new)
   */
  useEffect(() => {
    if (!file?.filename) return;
    if (!omitted) return;
    if (!onRequestFullFile) return;

    const side = status === "removed" ? "old" : "new";
    const key = `${file.filename}::${side}`;

    // Prevent repeated auto fetch for the same file+side
    if (autoLoadedKeyRef.current === key) return;
    autoLoadedKeyRef.current = key;

    // If user already opened full panel manually, don't fight them; but still load if empty.
    if (autoLoaded) return;

    setAutoLoaded(true);

    // Automatically open & load full file
    requestFullLatest(side, { forceOpen: true });
    // Optional: inline mode gives a better "full text" read if user switches back
    setMode("inline");
  }, [file?.filename, omitted, status, onRequestFullFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measure max content widths (for Azure-style bottom horizontal scrollbars)
  useEffect(() => {
    if (!surfaceRef.current) return;
    if (mode === "inline") return;

    const root = surfaceRef.current;

    requestAnimationFrame(() => {
      const oldEls = Array.from(root.querySelectorAll(".cell.old .code-inner"));
      const newEls = Array.from(root.querySelectorAll(".cell.neu .code-inner"));

      const oldMax = oldEls.reduce((m, n) => Math.max(m, n.scrollWidth || 0), 0);
      const newMax = newEls.reduce((m, n) => Math.max(m, n.scrollWidth || 0), 0);

      const oldViewportEl = root.querySelector(".cell.old .code");
      const newViewportEl = root.querySelector(".cell.neu .code");

      const oldViewport = oldViewportEl?.clientWidth || 0;
      const newViewport = newViewportEl?.clientWidth || 0;

      setScrollMetrics({ oldMax, newMax, oldViewport, newViewport });

      // reset scrollbars
      if (oldBarRef.current) oldBarRef.current.scrollLeft = 0;
      if (newBarRef.current) newBarRef.current.scrollLeft = 0;
      root.style.setProperty("--oldX", "0");
      root.style.setProperty("--newX", "0");
    });
  }, [mode, file?.filename, patch]);

  if (!file) return <div className="empty">Select a file to view diff</div>;

  // Added files: show full file (Azure-like behavior)
  const addedFull = status === "added" ? extractAddedFileContentFromPatch(patch) : "";

  return (
    <>
    <div ref={surfaceRef} className={`diff-surface az mode-${mode}`}>
      <div className="sticky file-header">{file.filename}</div>

      <div className="diff-toolbar sticky" ref={toolbarRef}>
        <div className="diff-toolbar__left">
          <div className="mode-dropdown-wrapper">
            <button 
              className="mode-btn mode-dropdown-toggle" 
              onClick={() => setModeDropdown(!modeDropdown)}
              title="Change view mode"
            >
              {mode === "inline" ? "Inline" : mode === "side" ? "Side" : "Modified"} ▾
            </button>
            {modeDropdown && (
              <div className="mode-dropdown-menu">
                <button 
                  className={`mode-dropdown-item ${mode === "inline" ? "active" : ""}`} 
                  onClick={() => { setMode("inline"); setModeDropdown(false); }}
                >
                  Inline
                </button>
                <button 
                  className={`mode-dropdown-item ${mode === "side" ? "active" : ""}`} 
                  onClick={() => { setMode("side"); setModeDropdown(false); }}
                >
                  Side by Side
                </button>
                <button 
                  className={`mode-dropdown-item ${mode === "modified" ? "active" : ""}`} 
                  onClick={() => { setMode("modified"); setModeDropdown(false); }}
                >
                  Modified
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="diff-toolbar__right">
          <span className="diff-toolbar__badge">{status.toUpperCase()}</span>
          <span className="diff-toolbar__stats">+{file.additions || 0} / -{file.deletions || 0}</span>
          <span className="diff-toolbar__stats">Findings: {findingsCount}</span>

          {showFull && (
            <button className="btn" onClick={() => setFullScreenMode(true)} title="View in full screen">
              ⛶ Full Screen
            </button>
          )}

          {onRequestFullFile && (
            <>
              <button className="btn" onClick={() => requestFullLatest("old")}>View base</button>
              <button className="btn primary" onClick={() => requestFullLatest("new")}>View latest</button>
            </>
          )}
        </div>
      </div>

      {showFull && (
        <div className="az-fullpanel">
          <div className="az-fullpanel__hdr">
            <b>Full file content</b>
            <button className="btn" onClick={() => setShowFull(false)}>
              Close
            </button>
          </div>

          {fullLoading && (
            <div className="muted" style={{ marginTop: 8 }}>
              Loading…
            </div>
          )}

          {fullError && (
            <div className="error" style={{ marginTop: 8 }}>
              {fullError}
            </div>
          )}

          {!fullLoading && !fullError && <pre className="az-fullpanel__pre">{fullText || "(empty)"}</pre>}
        </div>
      )}

      {/* Added file: show full content from patch */}
      {status === "added" && addedFull && <pre className="az-addedfile">{addedFull}</pre>}

      {/* Missing/omitted patch */}
      {status !== "added" && omitted && !showFull && (
        <div className="empty" style={{ padding: 12 }}>
          Diff is not available (omitted/truncated).
          {onRequestFullFile ? (
            <>
              {" "}
              Auto-loading full file… If it doesn’t appear, use <b>View latest</b> / <b>View base</b>.
            </>
          ) : (
            <>
              {" "}
              Wire <b>onRequestFullFile</b> (calls <b>window.api.getFileContent</b>) to enable full-file loading.
            </>
          )}
        </div>
      )}

      {/* Normal diff render */}
      {!omitted && status !== "added" && (
        <>
          {hunks.map((h, hIdx) => {
            const pairedAll = buildSplitRowsFromHunk(h.header, h.lines).map((r, idx) => ({ ...r, origIndex: idx }));
            const paired = mode === "modified" ? pairedAll.filter((r) => r.kind !== "ctx") : pairedAll;

            const displayItems =
              mode === "modified" ? paired.map((row) => ({ type: "row", row })) : buildSmartCollapsedItems(paired, hIdx, expandedFolds);

            return (
              <div key={hIdx} className="hunk">
                <div className="sticky hunk-header">{h.header}</div>

                {mode !== "inline" && (
                  <div className="split-head">
                    <div className="coltitle">Old</div>
                    <div className="coltitle">New</div>
                  </div>
                )}

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
                  const joinedNorm = normalize(joined);

                  const matched = findingsForFile.filter((f) => {
                    const mt = String(f?.matchText || "").trim();
                    if (!mt) return false;
                    const mNorm = normalize(mt);
                    if (!mNorm) return false;
                    return joinedNorm.includes(mNorm) || (mNorm.length >= 12 && joinedNorm.includes(mNorm.slice(0, 24)));
                  });

                  // Inline mode
                  if (mode === "inline") {
                    const marker = r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
                    const text = r.kind === "del" ? r.left || "" : r.right || r.left || "";

                    return (
                      <div key={`in-${hIdx}-${r.origIndex}-${idx}`} className={`inline-row ${r.kind}`}>
                        <div className="inline-ln">{r.oldNo ?? ""}</div>
                        <div className="inline-ln">{r.newNo ?? ""}</div>
                        <div className="inline-code">
                          <span className="inline-marker">{marker}</span>
                          <span className="inline-text">{text}</span>
                        </div>

                        {matched.map((f, fIdx) => (
                          <div key={`in-c-${fIdx}`} className="inline-comment-row">
                            <InlineComment finding={f} />
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // Side/Modified mode
                  return (
                    <div key={`${hIdx}-${r.origIndex}-${idx}`} className={`split-row ${r.kind}`}>
                      <div className="cell old">
                        <div className="ln">{r.oldNo ?? ""}</div>
                        <div className="code">
                          <span className="code-inner">{r.left || ""}</span>
                        </div>
                      </div>

                      <div className="cell neu">
                        <div className="ln">{r.newNo ?? ""}</div>
                        <div className="code">
                          <span className="code-inner">{r.right || ""}</span>
                        </div>
                      </div>

                      {r.noNewline && <div className="no-newline-row">\\ No newline at end of file</div>}

                      {matched.map((f, fIdx) => (
                        <div key={`c-${fIdx}`} className="inline-comment-row">
                          <InlineComment finding={f} />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Azure-like twin horizontal scrollbars */}
          {mode !== "inline" && (
            <div className="az-hscrollbar-row sticky">
              <div
                className="az-hscroll old"
                ref={oldBarRef}
                onScroll={(e) => applyOldX(e.currentTarget.scrollLeft)}
                title="Old file horizontal scroll"
              >
                <div style={{ width: Math.max(scrollMetrics.oldMax, scrollMetrics.oldViewport) }} />
              </div>

              <div
                className="az-hscroll neu"
                ref={newBarRef}
                onScroll={(e) => applyNewX(e.currentTarget.scrollLeft)}
                title="New file horizontal scroll"
              >
                <div style={{ width: Math.max(scrollMetrics.newMax, scrollMetrics.newViewport) }} />
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {/* Full-Screen Modal for Source Code */}
    {fullScreenMode && (
      <div className="fullscreen-overlay">
        <div className="fullscreen-container">
          <div className="fullscreen-header">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="fullscreen-title">{file.filename}</div>
              <div className="muted" style={{ fontSize: 12 }}>Full file source code view</div>
            </div>
            <button className="btn" onClick={() => setFullScreenMode(false)}>✖ Close</button>
          </div>
          <div className="fullscreen-body">
            {fullLoading && <div className="muted">Loading…</div>}
            {fullError && <div className="error">{fullError}</div>}
            {!fullLoading && !fullError && <pre className="fullscreen-pre">{fullText || "(empty)"}</pre>}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
