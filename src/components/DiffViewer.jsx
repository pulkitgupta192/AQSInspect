import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import AIInsightsPanel from "./AIInsightsPanel";
import ReviewWorkflowPanel from "./ReviewWorkflowPanel";

const ROW_HEIGHT = 28;

export default function DiffViewer({ diffData = [] }) {
  const [viewMode, setViewMode] = useState("split");
  const [selectedFile, setSelectedFile] = useState(diffData[0]?.filePath || "");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [aiFilter, setAiFilter] = useState("ALL");
  const [reviewState, setReviewState] = useState("pending");
  const [reviewedFiles, setReviewedFiles] = useState({});
  const listRef = useRef(null);

  // keep selected file valid when diffData changes
  useEffect(() => {
    if (!diffData?.length) {
      setSelectedFile("");
      return;
    }
    if (!selectedFile) setSelectedFile(diffData[0].filePath);
    const exists = diffData.some((f) => f.filePath === selectedFile);
    if (!exists) setSelectedFile(diffData[0].filePath);
  }, [diffData, selectedFile]);

  const hasHighRisk = useMemo(() => {
    return diffData.some((f) =>
      (f.hunks || []).some((h) =>
        (h.lines || []).some((l) => l?.ai?.severity === "HIGH")
      )
    );
  }, [diffData]);

  const flattenedLines = useMemo(() => {
    const file = diffData.find((f) => f.filePath === selectedFile);
    if (!file) return [];
    const out = [];
    (file.hunks || []).forEach((hunk) => {
      (hunk.lines || []).forEach((line, idx) => {
        const content = String(line?.content ?? "");
        if (ignoreWhitespace && content.trim() === "") return;

        if (aiFilter !== "ALL") {
          if (!line.ai || line.ai.severity !== aiFilter) return;
        }

        out.push({ ...line, key: `${hunk.id || "h"}-${idx}` });
      });
    });
    return out;
  }, [selectedFile, diffData, ignoreWhitespace, aiFilter]);

  // keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "n") jump(1);
      if (e.key === "p") jump(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flattenedLines, currentIndex]);

  const jump = (step) => {
    if (!flattenedLines.length) return;
    const next = Math.max(0, Math.min(flattenedLines.length - 1, currentIndex + step));
    setCurrentIndex(next);
    listRef.current?.scrollToItem(next);
  };

  // workflow handlers
  const handleApprove = () => {
    if (hasHighRisk) {
      alert("Cannot approve: HIGH risk issues exist");
      return;
    }
    setReviewState("approved");
  };
  const handleApproveWithComments = () => setReviewState("approved_with_comments");
  const handleBlock = () => setReviewState("blocked");

  const toggleFileReview = (filePath) => {
    setReviewedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  return (
    <div style={styles.container}>
      {/* LEFT PANEL */}
      <div style={styles.sidebar}>
        <div style={styles.header}>FILES</div>
        {diffData.map((file) => (
          <div
            key={file.filePath}
            style={{
              ...styles.fileItem,
              background: selectedFile === file.filePath ? "#1e293b" : "transparent",
            }}
            onClick={() => {
              setSelectedFile(file.filePath);
              setCurrentIndex(0);
              listRef.current?.scrollToItem(0);
            }}
            title={file.filePath}
          >
            {file.filePath}
            {reviewedFiles[file.filePath] ? " ✅" : ""}
          </div>
        ))}
      </div>

      {/* CENTER */}
      <div style={styles.main}>
        {/* TOOLBAR */}
        <div style={styles.toolbar}>
          <button onClick={() => setViewMode("split")}>Split</button>
          <button onClick={() => setViewMode("unified")}>Unified</button>

          <label style={{ marginLeft: 10, display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={() => setIgnoreWhitespace((v) => !v)}
            />
            Ignore WS
          </label>

          <div style={styles.filterGroup}>
            {["ALL", "HIGH", "MEDIUM", "LOW"].map((f) => (
              <button
                key={f}
                style={{
                  ...styles.filterBtn,
                  background: aiFilter === f ? "#38bdf8" : "#1e293b",
                }}
                onClick={() => {
                  setAiFilter(f);
                  setCurrentIndex(0);
                  listRef.current?.scrollToItem(0);
                }}
              >
                {f}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, opacity: 0.8 }}>
            <span>n: next</span>
            <span>p: prev</span>
          </div>
        </div>

        {/* DIFF */}
        <div style={styles.diffWrapper}>
          <VirtualList
            ref={listRef}
            height={600}
            itemCount={flattenedLines.length}
            itemSize={ROW_HEIGHT}
            width="100%"
            overscan={12}
          >
            {({ index, style }) => {
              const line = flattenedLines[index];
              return (
                <DiffRow
//                  line={line}
				  
				  
					{parsePatch(file.patch).map((l) => (
					  <div
						key={l.index}
						className={`diff-line ${l.type}`}
					  >
						{l.line}
					  </div>
					))}
				  
                  viewMode={viewMode}
                  style={style}
                  isActive={index === currentIndex}
                />
              );
            }}
          </VirtualList>

          {/* MINIMAP */}
          <Minimap
            lines={flattenedLines}
            onSelect={(idx) => {
              setCurrentIndex(idx);
              listRef.current?.scrollToItem(idx);
            }}
          />
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={styles.rightPanel}>
        <AIInsightsPanel
          diffData={diffData}
          onFilterChange={(severity) => {
            setAiFilter(severity);
            setCurrentIndex(0);
            listRef.current?.scrollToItem(0);
          }}
        />
        <ReviewWorkflowPanel
          diffData={diffData}
          reviewState={reviewState}
          reviewedFiles={reviewedFiles}
          onApprove={handleApprove}
          onBlock={handleBlock}
          onApproveWithComments={handleApproveWithComments}
          onToggleFileReview={toggleFileReview}
        />
      </div>
    </div>
  );
}

/** Minimal virtualization with scrollToItem() */
const VirtualList = forwardRef(function VirtualList(
  { height, itemCount, itemSize, width, overscan = 8, children },
  ref
) {
  const outerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  useImperativeHandle(ref, () => ({
    scrollToItem: (index) => {
      if (!outerRef.current) return;
      outerRef.current.scrollTop = Math.max(0, index * itemSize);
    },
  }));

  const onScroll = (e) => setScrollTop(e.currentTarget.scrollTop);

  const totalHeight = itemCount * itemSize;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - overscan);
  const visibleCount = Math.ceil(height / itemSize) + overscan * 2;
  const endIndex = Math.min(itemCount - 1, startIndex + visibleCount);

  const items = [];
  for (let i = startIndex; i <= endIndex; i++) {
    items.push(
      <div
        key={i}
        style={{
          position: "absolute",
          top: i * itemSize,
          height: itemSize,
          width: "100%",
        }}
      >
        {children({ index: i, style: { height: itemSize } })}
      </div>
    );
  }

  return (
    <div ref={outerRef} onScroll={onScroll} style={{ height, width, overflowY: "auto", position: "relative" }}>
      <div style={{ height: totalHeight, position: "relative" }}>{items}</div>
    </div>
  );
});

function DiffRow({ line, viewMode, style, isActive }) {
  const content = String(line?.content ?? "");
  return (
    <div
      style={{
        ...styles.row,
        ...getLineStyle(line?.type),
        ...(isActive ? styles.activeRow : {}),
        ...style,
      }}
    >
      {viewMode === "split" ? (
        <>
          <div style={styles.lineNum}>{line?.oldLine ?? ""}</div>
          <div style={styles.code}>{line?.type !== "add" ? content : ""}</div>
          <div style={styles.lineNum}>{line?.newLine ?? ""}</div>
          <div style={styles.code}>{line?.type !== "delete" ? content : ""}</div>
        </>
      ) : (
        <>
          <div style={styles.lineNum}>{line?.oldLine ?? line?.newLine ?? ""}</div>
          <div style={styles.code}>{content}</div>
        </>
      )}

      {line?.ai && (
        <div style={styles.aiInline}>
          ⚠️ {line.ai.message} ({line.ai.severity})
        </div>
      )}
    </div>
  );
}

function Minimap({ lines, onSelect }) {
  return (
    <div style={styles.minimap}>
      {lines.map((line, i) => {
        let color = "#334155";
        if (line?.type === "add") color = "#22c55e";
        if (line?.type === "delete") color = "#ef4444";
        if (line?.ai?.severity === "HIGH") color = "#facc15";
        return (
          <div
            key={i}
            onClick={() => onSelect(i)}
            style={{ height: 3, background: color, cursor: "pointer" }}
          />
        );
      })}
    </div>
  );
}

function parsePatch(patch) {
  if (!patch) return [];

  return patch.split("\n").map((line, index) => {
    let type = "context";

    if (line.startsWith("+")) type = "added";
    else if (line.startsWith("-")) type = "removed";

    return { line, type, index };
  });
}

function getLineStyle(type) {
  if (type === "add") return { background: "#022c22" };
  if (type === "delete") return { background: "#3f1d1d" };
  return {};
}

export default function DiffViewer({ diff }) {
  if (!diff) return <div>No diff loaded</div>

  const lines = diff.split('\n')

  return (
    <div style={{
      width: '60%',
      background: '#1e1e1e',
      color: '#ddd',
      padding: 10,
      fontFamily: 'monospace',
      overflow: 'auto'
    }}>
      {lines.map((line, i) => {
        let bg = 'transparent'

        if (line.startsWith('+')) bg = '#144212'
        else if (line.startsWith('-')) bg = '#5a1d1d'
        else if (line.startsWith('@@')) bg = '#333'

        return (
          <div key={i} style={{ background: bg, padding: '2px 4px' }}>
            {line}
          </div>
        )
      })}
    </div>
  )
}

const styles = {
  container: {
    display: "flex",
    height: "100vh",
    background: "#0f172a",
    color: "#e2e8f0",
    fontFamily: "monospace",
  },
  sidebar: { width: 240, borderRight: "1px solid #1e293b", overflowY: "auto" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  rightPanel: { width: 340, display: "flex", flexDirection: "column", borderLeft: "1px solid #1e293b", overflowY: "auto" },
  toolbar: { padding: 10, borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 8 },
  filterGroup: { marginLeft: 12, display: "flex", gap: 6 },
  filterBtn: { padding: "4px 10px", border: "none", cursor: "pointer", color: "#fff", borderRadius: 6 },
  diffWrapper: { display: "flex", flex: 1, minHeight: 0 },
  minimap: { width: 10, background: "#020617" },
  row: { display: "flex", alignItems: "center", fontSize: 13, padding: "0 8px", gap: 8, boxSizing: "border-box" },
  lineNum: { width: 50, opacity: 0.6, flexShrink: 0 },
  code: { flex: 1, whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" },
  aiInline: { marginLeft: 10, fontSize: 12, color: "#facc15", flexShrink: 0, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  activeRow: { outline: "1px solid #38bdf8" },
  fileItem: { padding: 10, cursor: "pointer", borderBottom: "1px solid rgba(30,41,59,0.35)" },
  header: { padding: 10, fontWeight: "bold", borderBottom: "1px solid #1e293b", position: "sticky", top: 0, background: "#0b1220", zIndex: 1 },
};
