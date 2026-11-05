import { describe, expect, it } from "vitest";
import { secretsProblem } from "./secrets-check";

describe("secrets at start-up", () => {
  const prod = { NODE_ENV: "production" };
  it("refuses example secrets from the repository in production", () => {
    expect(
      secretsProblem({
        ...prod,
        CREDENTIALS_ENCRYPTION_KEY:
          "df971de4e323c0740729647e79146401fbb1bc01e5a9cd7580fe617b4f93cc6a",
      }),
    ).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(secretsProblem({ ...prod, AUTH_SECRET: "change-me-long-random-secret" })).toMatch(
      /AUTH_SECRET/,
    );
    expect(
      secretsProblem({ ...prod, SMS_CALLBACK_TOKEN: "dev-sms-callback-token-change-me" }),
    ).toMatch(/SMS_CALLBACK_TOKEN/);
  });

  it("accepts real secrets, development, and demo servers", () => {
    expect(secretsProblem({ ...prod, AUTH_SECRET: "q8Zr7xVwP2mLk9sT4bN6cY1hJ3fD5gA0" })).toBeNull();
    expect(secretsProblem({ NODE_ENV: "development", AUTH_SECRET: "test-secret" })).toBeNull();
    expect(secretsProblem({ ...prod, KIOTA_DEMO: "1", AUTH_SECRET: "e2e-secret" })).toBeNull();
  });
});
