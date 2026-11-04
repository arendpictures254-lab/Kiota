import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/hosts";

/** Lets staff and parents add Kiota to their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kiota",
    short_name: "Kiota",
    description: "Every child, one place.",
    start_url: `${APP_URL}/dashboard`,
    display: "standalone",
    background_color: "#FBF7F0",
    theme_color: "#1F5F63",
    icons: [
      { src: "/brand/kiota-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/kiota-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
