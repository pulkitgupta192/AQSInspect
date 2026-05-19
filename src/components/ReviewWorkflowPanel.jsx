import React, { useMemo } from "react";

export default function ReviewWorkflowPanel({
  diffData = [],
  reviewState = "pending",
  reviewedFiles = {},
  onApprove,
  onBlock,
  onApproveWithComments,
  onToggleFileReview,
}) {
  const stats = useMemo(() => {
    const totalFiles = diffData.length;
    const reviewedCount = Object.keys(reviewedFiles).filter((k) => reviewedFiles[k]).length;
    return {
      totalFiles,
      reviewedCount,
      progress: totalFiles === 0 ? 0 : Math.round((reviewedCount / totalFiles) * 100),
    };
  }, [diffData, reviewedFiles]);

  return (
    <div style={styles.container}>
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Review Workflow</div>

      <div style={styles.section}>
        <div style={{ opacity: 0.8, fontSize: 12 }}>
          Progress: {stats.reviewedCount}/{stats.totalFiles} ({stats.progress}%)
        </div>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${stats.progress}%` }} />
        </div>
      </div>

      <div style={styles.section}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Files</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflow: "auto" }}>
          {diffData.map((f) => (
            <div key={f.filePath} style={styles.fileRow}>
              <span style={{ opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.filePath}
              </span>
              <button style={styles.smallBtn} onClick={() => onToggleFileReview?.(f.filePath)}>
                {reviewedFiles[f.filePath] ? "Reviewed ✅" : "Mark reviewed"}
              </button>
            </div>
          ))}
          {!diffData.length && <div style={{ opacity: 0.7 }}>No files loaded.</div>}
        </div>
      </div>

      <div style={styles.section}>
        <div style={{ opacity: 0.8, fontSize: 12 }}>
          Status: <b>{String(reviewState).toUpperCase()}</b>
        </div>
      </div>

      <div style={styles.actions}>
        <button style={{ ...styles.actionBtn, background: "#22c55e" }} onClick={onApprove}>
          ✅ Approve
        </button>
        <button style={{ ...styles.actionBtn, background: "#facc15", color: "#111827" }} onClick={onApproveWithComments}>
          ⚡ Approve with Comments
        </button>
        <button style={{ ...styles.actionBtn, background: "#ef4444" }} onClick={onBlock}>
          ⛔ Block PR
        </button>
      </div>
    </div>
  );
}

export default function ReviewPanel({ review }) {
  return (
    <div style={{
      width: '40%',
      padding: 10,
      background: '#0f172a',
      color: '#fff'
    }}>
      <h3>AI Review</h3>

      <pre style={{ whiteSpace: 'pre-wrap' }}>
        {review || 'No review yet'}
      </pre>

      <button onClick={() => alert('Approved')}>
        ✅ Approve
      </button>

      <button onClick={() => alert('Changes Requested')}>
        ❌ Request Changes
      </button>
    </div>
  )
}

const styles = {
  container: { padding: 14, background: "#020617", color: "#e2e8f0" },
  section: { marginBottom: 12 },
  progressBar: { height: 8, background: "#1e293b", marginTop: 8, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", background: "#38bdf8" },
  fileRow: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, alignItems: "center" },
  smallBtn: { padding: "6px 10px", borderRadius: 8, border: "1px solid #1e293b", background: "#0b1220", color: "#e2e8f0", cursor: "pointer", whiteSpace: "nowrap" },
  actions: { display: "flex", flexDirection: "column", gap: 8 },
  actionBtn: { border: "none", padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontWeight: 900 },
};
