"use client";

import { useEffect } from "react";

/** Registers public/sw.js (installable app, offline page). Only on the app address. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !location.hostname.startsWith("app.")) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not supported or blocked: the app works the same without it.
    });
  }, []);
  return null;
}
