import { ImageResponse } from "next/og";

export const alt = "Skein — one request, every thread: token listing verdicts with a receipt for every input";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card shown when a Skein link is shared (Open Graph and Twitter). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", background: "#0b0b0c", color: "#f4f1ea", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, textTransform: "uppercase", color: "#b8b2a7" }}>Skein</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, lineHeight: 1.02, fontWeight: 600 }}>One request.</div>
          <div style={{ fontSize: 88, lineHeight: 1.02, fontWeight: 600 }}>Every thread.</div>
          <div style={{ marginTop: 32, fontSize: 32, color: "#b8b2a7", maxWidth: 980 }}>
            Is this token fit to list? A signed verdict, fused from paid Telegraph checks, with a receipt for every input.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 26 }}>
          {["APPROVE", "ESCALATE", "REJECT", "ABSTAIN"].map((v) => (
            <div key={v} style={{ display: "flex", padding: "8px 18px", border: "2px solid #3a3833", borderRadius: 999 }}>{v}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
