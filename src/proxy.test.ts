// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

// Development defaults: site on localhost:3000, app on app.localhost:3000.
function hit(url: string) {
  const u = new URL(url);
  const res = proxy(new NextRequest(url, { headers: { host: u.host } }));
  return {
    status: res.status,
    // Cross-address redirects go through /go-to?to=<url>.
    location: res.headers.get("location") ?? res.headers.get("x-middleware-request-x-kiota-go-to"),
    rewrite: res.headers.get("x-middleware-rewrite"),
  };
}

describe("site address (kiota.app / localhost:3000)", () => {
  it("serves site pages from /site", () => {
    expect(hit("http://localhost:3000/").rewrite).toBe("http://localhost:3000/site");
    expect(hit("http://localhost:3000/features").rewrite).toBe(
      "http://localhost:3000/site/features",
    );
    expect(hit("http://localhost:3000/demo?x=1").rewrite).toBe(
      "http://localhost:3000/site/demo?x=1",
    );
  });

  it("sends app paths to the app address", () => {
    for (const path of [
      "/sign-in",
      "/dashboard",
      "/dashboard/students",
      "/admin",
      "/schools",
      "/files/x",
    ]) {
      const r = hit(`http://localhost:3000${path}`);
      expect(r.location, path).toBe(`http://app.localhost:3000${path}`);
    }
  });

  it("does not expose the internal /site paths", () => {
    expect(hit("http://localhost:3000/site/features").rewrite).toContain("/_not-found-kiota");
  });
});

describe("app address (app.kiota.app / app.localhost:3000)", () => {
  it("serves the app and sends / to the dashboard", () => {
    expect(hit("http://app.localhost:3000/sign-in").rewrite).toBeNull();
    expect(hit("http://app.localhost:3000/sign-in").status).toBe(200);
    expect(hit("http://app.localhost:3000/").location).toBe("http://app.localhost:3000/dashboard");
  });

  it("sends site pages to the site address and hides /site", () => {
    expect(hit("http://app.localhost:3000/features").location).toBe(
      "http://localhost:3000/features",
    );
    expect(hit("http://app.localhost:3000/privacy").location).toBe("http://localhost:3000/privacy");
    expect(hit("http://app.localhost:3000/site").rewrite).toContain("/_not-found-kiota");
  });
});

describe("any other host", () => {
  it("gets nothing", () => {
    expect(hit("http://203.0.113.5/dashboard").status).toBe(404);
    expect(hit("http://evil.example/").status).toBe(404);
  });
});
