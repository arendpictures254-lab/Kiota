import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // PDF receipts: pdfkit reads its own font metrics from disk, and our brand fonts and logos
  // are read at run time, so ship them with the server.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**", "./public/brand/*.png"],
  },
  // Storage and SMS code use paths under the working directory, so the file tracer would copy the
  // whole project into the image. Leave out everything the server never reads.
  outputFileTracingExcludes: {
    "*": [
      "docs/**",
      "e2e/**",
      "tests/**",
      "scripts/**",
      "deploy/**",
      "backups/**",
      ".pgdata/**",
      ".storage/**",
      ".storage-test/**",
      ".dev/**",
      "test-results/**",
      "playwright-report/**",
      "*.md",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
  },
  // The app runs on app.localhost:3000 in development, next to the site on localhost:3000.
  allowedDevOrigins: [
    "app.localhost",
    "localhost",
    // npm run dev:phone adds this computer's Wi-Fi address, for trying it on a real phone.
    ...(process.env.KIOTA_DEV_ORIGINS?.split(",").filter(Boolean) ?? []),
  ],
  cacheComponents: true,
  experimental: {
    // Student photos, documents and Excel imports (each limited to 5 MB in the services).
    serverActions: { bodySizeLimit: "6mb" },
  },
  partialPrefetching: true,
  // The service worker (installable app, offline page): never cached, so updates arrive at once.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
