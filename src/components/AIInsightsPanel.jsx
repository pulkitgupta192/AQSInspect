import React, { useMemo } from "react";

export default function AIInsightsPanel({ findings = [], onFilterChange }) {
  const insights = useMemo(() => {
    let high = 0,
      medium = 0,
      low = 0;
    const issues = [];

    (findings || []).forEach((item) => {
      const severityRaw = String(item.severity || "info").toLowerCase();
      const severity = severityRaw === "critical" ? "HIGH" : severityRaw === "warning" ? "MEDIUM" : severityRaw.toUpperCase();

      if (severity === "HIGH") high++;
      else if (severity === "MEDIUM") medium++;
      else low++;

      issues.push({
        message: item.explanation || item.title || "Review finding",
        severity,
        confidence: item.confidence ?? 0,
        file: item.filename || "Unknown",
      });
    });

    const score = Math.max(0, 100 - (high * 10 + medium * 5 + low * 2));
    return { high, medium, low, issues, score };
  }, [findings]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ fontWeight: 800 }}>AI Insights</div>
        <div style={styles.score}>{insights.score}/100</div>
      </div>

      <div style={styles.kpiRow}>
        <KPI label="High" value={insights.high} color="#ef4444" onClick={() => onFilterChange?.("HIGH")} />
        <KPI label="Medium" value={insights.medium} color="#fbbf24" onClick={() => onFilterChange?.("MEDIUM")} />
        <KPI label="Low" value={insights.low} color="#22c55e" onClick={() => onFilterChange?.("LOW")} />
      </div>

      <div style={styles.section}>
        <div style={{ fontWeight: 700 }}>Summary</div>
        <div style={styles.summaryText}>
          {insights.high > 0
            ? "Critical issues detected. Focus remediation on these files first."
            : insights.medium > 0
            ? "Moderate issues present. Continue review for maintainability and risk."
            : "No high-risk issues detected. Continue with standard validation."}
        </div>
      </div>

      <div style={styles.section}>
        <div style={{ fontWeight: 700 }}>Top Findings</div>
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
          {!insights.issues.length && <div style={{ opacity: 0.7 }}>No AI findings available yet.</div>}
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
  if (severity === "MEDIUM") return "#fbbf24";
  return "#22c55e";
}

const styles = {
  container: {
    width: "100%",
    background: "#ffffff",
    padding: 16,
    color: "#111827",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    border: "1px solid rgba(15, 23, 42, 0.08)",
    borderRadius: 14,
    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.06)",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  score: { fontSize: 20, fontWeight: 900, color: "#2563eb" },
  kpiRow: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 },
  kpiCard: {
    flex: 1,
    padding: 12,
    textAlign: "center",
    background: "#f8fafc",
    borderRadius: 12,
    cursor: "pointer",
    border: "1px solid transparent",
    color: "#111827",
  },
  kpiValue: { fontSize: 18, fontWeight: 900 },
  kpiLabel: { fontSize: 12, opacity: 0.75 },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  summaryText: { fontSize: 13, lineHeight: 1.6, opacity: 0.9 },
  issueList: { display: "flex", flexDirection: "column", gap: 12, maxHeight: 220, overflowY: "auto" },
  issueItem: {
    padding: 14,
    borderRadius: 14,
    background: "#f8fafc",
    fontSize: 13,
    border: "1px solid rgba(15, 23, 42, 0.06)",
  },
  issueHeader: { display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8, flexWrap: "wrap" },
  badge: { padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 900, color: "#fff" },
  file: { fontSize: 11, opacity: 0.7 },
  issueText: { marginBottom: 6, opacity: 0.95 },
  confidence: { fontSize: 11, opacity: 0.7 },
};
