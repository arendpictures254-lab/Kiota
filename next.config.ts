import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
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
  allowedDevOrigins: ["app.localhost", "localhost"],
  cacheComponents: true,
  experimental: {
    // Student photos, documents and Excel imports (each limited to 5 MB in the services).
    serverActions: { bodySizeLimit: "6mb" },
  },
  partialPrefetching: true,
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
