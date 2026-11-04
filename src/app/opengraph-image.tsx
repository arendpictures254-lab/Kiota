import { ImageResponse } from "next/og";

/** Social preview image for every page (WhatsApp, Facebook, X, LinkedIn link previews). */
export const alt = "Kiota: every child, one place. School management for Kenyan schools.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "#FBF7F0",
        color: "#1E2422",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            background: "#1F5F63",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FBF7F0",
            fontSize: 84,
            fontWeight: 700,
          }}
        >
          K
        </div>
        <div style={{ fontSize: 96, fontWeight: 700, color: "#1F5F63", letterSpacing: -2 }}>
          Kiota
        </div>
      </div>
      <div style={{ marginTop: 48, fontSize: 64, fontWeight: 700 }}>Every child, one place.</div>
      <div style={{ marginTop: 20, fontSize: 32, color: "#3d4441", maxWidth: 980 }}>
        Fees, report cards, parent messages and boarding for Kenyan schools.
      </div>
      <div
        style={{ marginTop: 48, width: 120, height: 10, borderRadius: 5, background: "#C9A27A" }}
      />
    </div>,
    size,
  );
}
