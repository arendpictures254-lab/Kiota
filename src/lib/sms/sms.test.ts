import { describe, expect, it } from "vitest";
import { whatsappConfigProblem } from "@/lib/whatsapp";
import { atDeliveryOutcome } from "./africastalking-driver";
import { smsConfigProblem } from "./index";

describe("SMS settings at start-up", () => {
  it("allow the console driver in development", () => {
    expect(smsConfigProblem({ NODE_ENV: "development" })).toBeNull();
    expect(smsConfigProblem({ NODE_ENV: "development", SMS_DRIVER: "console" })).toBeNull();
  });

  it("refuse the console driver in production", () => {
    expect(smsConfigProblem({ NODE_ENV: "production", SMS_DRIVER: "console" })).toMatch(/console/);
    expect(smsConfigProblem({ NODE_ENV: "production" })).toMatch(/console/);
  });

  it("refuse ALLOW_CONSOLE_SMS in production unless it is a demo server", () => {
    expect(
      smsConfigProblem({ NODE_ENV: "production", SMS_DRIVER: "console", ALLOW_CONSOLE_SMS: "1" }),
    ).toMatch(/ALLOW_CONSOLE_SMS/);
    expect(
      smsConfigProblem({
        NODE_ENV: "production",
        SMS_DRIVER: "africastalking",
        AT_USERNAME: "kiota",
        AT_API_KEY: "k",
        ALLOW_CONSOLE_SMS: "1",
      }),
    ).toMatch(/ALLOW_CONSOLE_SMS/);
    expect(
      smsConfigProblem({
        NODE_ENV: "production",
        SMS_DRIVER: "console",
        ALLOW_CONSOLE_SMS: "1",
        KIOTA_DEMO: "1",
      }),
    ).toBeNull();
  });

  it("need Africa's Talking credentials for the real driver", () => {
    expect(smsConfigProblem({ NODE_ENV: "production", SMS_DRIVER: "africastalking" })).toMatch(
      /AT_USERNAME/,
    );
    expect(
      smsConfigProblem({
        NODE_ENV: "production",
        SMS_DRIVER: "africastalking",
        AT_USERNAME: "kiota",
        AT_API_KEY: "key",
      }),
    ).toBeNull();
    expect(smsConfigProblem({ SMS_DRIVER: "carrier-pigeon" })).toMatch(/Unknown/);
  });

  it("read Africa's Talking delivery statuses", () => {
    expect(atDeliveryOutcome("Success")).toBe("delivered");
    expect(atDeliveryOutcome("Failed")).toBe("failed");
    expect(atDeliveryOutcome("Rejected")).toBe("failed");
    expect(atDeliveryOutcome("Buffered")).toBe("pending");
  });

  it("refuse WhatsApp console in production and need Cloud API secrets", () => {
    expect(whatsappConfigProblem({ NODE_ENV: "production" })).toBeNull(); // off by default
    expect(whatsappConfigProblem({ NODE_ENV: "production", WHATSAPP_DRIVER: "console" })).toMatch(
      /console/,
    );
    expect(whatsappConfigProblem({ WHATSAPP_DRIVER: "cloud", WHATSAPP_TOKEN: "t" })).toMatch(
      /PHONE_NUMBER_ID/,
    );
    expect(
      whatsappConfigProblem({
        WHATSAPP_DRIVER: "cloud",
        WHATSAPP_TOKEN: "t",
        WHATSAPP_PHONE_NUMBER_ID: "1",
        WHATSAPP_APP_SECRET: "s",
      }),
    ).toBeNull();
  });
});
