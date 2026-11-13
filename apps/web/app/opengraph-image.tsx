import { ImageResponse } from "next/og";

export const alt = "Skein — one request, every thread: token listing verdicts with a receipt for every input";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card shown when a Skein link is shared (Open Graph and Twitter). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", background: "#07090B", color: "#E6EDF0", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, textTransform: "uppercase", color: "#2EE6C8" }}>Skein</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, lineHeight: 1.02, fontWeight: 600 }}>One request.</div>
          <div style={{ fontSize: 88, lineHeight: 1.02, fontWeight: 600 }}>Every thread.</div>
          <div style={{ marginTop: 32, fontSize: 32, color: "#7C8B94", maxWidth: 980 }}>
            Is this token fit to list? A signed verdict, fused from paid Telegraph checks, with a receipt for every input.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 26 }}>
          {/* The verdict colours of the design tokens (packages/ui/src/theme.css); square, as everywhere else. */}
          {(
            [
              ["APPROVE", "#3DDC84"],
              ["ESCALATE", "#F2B84B"],
              ["REJECT", "#FF5D5D"],
              ["ABSTAIN", "#8A96A3"],
            ] as const
          ).map(([v, c]) => (
            <div key={v} style={{ display: "flex", padding: "8px 18px", border: `2px solid ${c}`, color: c }}>{v}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
