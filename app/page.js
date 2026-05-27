"use client";
import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  async function trigger() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      setStatus({ success: false, error: e.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "monospace", maxWidth: 520, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Email Digest Agent</h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 32 }}>
        Runs automatically every day at 8:00 AM UTC and sends a summary to your inbox.
      </p>
      <div style={{ background: "#f5f5f5", borderRadius: 6, padding: "16px 20px", marginBottom: 24, fontSize: 13 }}>
        <div style={{ marginBottom: 6 }}><strong>Schedule:</strong> Daily at 08:00 UTC</div>
        <div style={{ marginBottom: 6 }}><strong>Look-back:</strong> Last 24 hours (max 20 emails)</div>
        <div><strong>Features:</strong> Priority flags · Action items</div>
      </div>
      <button onClick={trigger} disabled={loading}
        style={{ background: loading ? "#999" : "#1a1a18", color: "#fff", border: "none",
          padding: "10px 22px", fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
          borderRadius: 4, marginBottom: 20 }}>
        {loading ? "Running digest..." : "Run now"}
      </button>
      {status && (
        <div style={{ padding: "14px 18px", borderRadius: 6, fontSize: 13,
          background: status.success ? "#edf7f2" : "#fdf0ef",
          color: status.success ? "#2d6a4f" : "#c0392b",
          border: `1px solid ${status.success ? "#b7e0cb" : "#f5c6c6"}` }}>
          {status.success ? `Digest sent — ${status.count} emails summarized.` : `Error: ${status.error}`}
        </div>
      )}
    </main>
  );
}
