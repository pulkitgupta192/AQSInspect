import React from "react";

/*
✅ MAIN PANEL (DEFAULT EXPORT)
*/
export default function ReviewWorkflowPanel({ data }) {
  if (!data) {
    return (
      <div style={{ padding: 10, color: "#aaa" }}>
        No review data available
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        padding: 10,
        borderTop: "1px solid #1f2937",
        overflowY: "auto",
      }}
    >
      <h3 style={{ marginBottom: 10 }}>Review Workflow</h3>

      {/* Example rendering (keep your original logic if different) */}
      {Array.isArray(data?.reviews) &&
        data.reviews.map((review, index) => (
          <ReviewPanel key={index} review={review} />
        ))}
    </div>
  );
}

/*
✅ CHILD COMPONENT (NO DEFAULT EXPORT)
*/
function ReviewPanel({ review }) {
  return (
    <div
      style={{
        border: "1px solid #374151",
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <div style={{ fontWeight: 600 }}>{review?.title || "Review"}</div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {review?.comment || "No details"}
      </div>
    </div>
  );
}