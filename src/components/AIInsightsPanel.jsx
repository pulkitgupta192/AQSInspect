import React, { useMemo } from "react";

export default function AIInsightsPanel({ diffData = [], onFilterChange }) {
  const insights = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    const issues = [];

    diffData.forEach((file) => {
      (file.hunks || []).forEach((hunk) => {
        (hunk.lines || []).forEach((line) => {
          if (line?.ai) {
            issues.push({
              message: line.ai.message,
              severity: line.ai.severity,
              confidence: line.ai.confidence,
              file: file.filePath,
            });
            if (line.ai.severity === "HIGH") high++;
            if (line.ai.severity === "MEDIUM") medium++;
            if (line.ai.severity === "LOW") low++;
          }
        });
      });
    });

    const score = Math.max(0, 100 - (high * 10 + medium * 5 + low * 2));
    return { high, medium, low, issues, score };
  }, [diffData]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ fontWeight: 800 }}>AI Review Insights</div>
        <div style={styles.score}>{insights.score}/100</div>
      </div>

      <div style={styles.kpiRow}>
        <KPI label="High" value={insights.high} color="#ef4444" onClick={() => onFilterChange?.("HIGH")} />
        <KPI label="Medium" value={insights.medium} color="#facc15" onClick={() => onFilterChange?.("MEDIUM")} />
        <KPI label="Low" value={insights.low} color="#22c55e" onClick={() => onFilterChange?.("LOW")} />
      </div>

      <div style={styles.section}>
        <div style={{ fontWeight: 700 }}>Summary</div>
        <div style={styles.summaryText}>
          {insights.high > 0
            ? "Critical issues detected. Immediate attention recommended."
            : insights.medium > 0
            ? "Moderate issues present. Review recommended."
            : "No major issues detected."}
        </div>
      </div>

      <div style={styles.section}>
        <div style={{ fontWeight: 700 }}>Top Issues</div>
        <div style={styles.issueList}>
          {insights.issues.slice(0, 5).map((issue, idx) => (
            <div key={idx} style={styles.issueItem}>
              <div style={styles.issueHeader}>
                <span style={{ ...styles.badge, background: getSeverityColor(issue.severity) }}>{issue.severity}</span>
                <span style={styles.file}>{issue.file}</span>
              </div>
              <div style={styles.issueText}>{issue.message}</div>
              <div style={styles.confidence}>
                Confidence: {typeof issue.confidence === "number" ? `${Math.round(issue.confidence * 100)}%` : "—"}
              </div>
            </div>
          ))}
          {!insights.issues.length && <div style={{ opacity: 0.7 }}>No AI annotations found.</div>}
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, color, onClick }) {
  return (
    <button onClick={onClick} style={{ ...styles.kpiCard, borderColor: color }}>
      <div style={{ ...styles.kpiValue, color }}>{value}</div>
      <div style={styles.kpiLabel}>{label}</div>
    </button>
  );
}

function getSeverityColor(severity) {
  if (severity === "HIGH") return "#ef4444";
  if (severity === "MEDIUM") return "#facc15";
  return "#22c55e";
}

const styles = {
  container: {
    width: 340,
    background: "#020617",
    padding: 14,
    color: "#e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    borderBottom: "1px solid #1e293b",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  score: { fontSize: 18, fontWeight: 900, color: "#38bdf8" },
  kpiRow: { display: "flex", gap: 8 },
  kpiCard: { flex: 1, padding: 10, textAlign: "center", background: "#0b1220", borderRadius: 10, cursor: "pointer", border: "1px solid #1e293b", color: "#e2e8f0" },
  kpiValue: { fontSize: 18, fontWeight: 900 },
  kpiLabel: { fontSize: 12, opacity: 0.75 },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  summaryText: { fontSize: 13, lineHeight: 1.4, opacity: 0.9 },
  issueList: { display: "flex", flexDirection: "column", gap: 10, maxHeight: 220, overflowY: "auto" },
  issueItem: { padding: 10, borderRadius: 10, background: "#0f172a", fontSize: 12 },
  issueHeader: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  badge: { padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 900, color: "#020617" },
  file: { fontSize: 11, opacity: 0.7 },
  issueText: { marginBottom: 4, opacity: 0.95 },
  confidence: { fontSize: 11, opacity: 0.75 },
};
