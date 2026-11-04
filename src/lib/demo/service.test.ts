import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/service-kit";
import { hashIp, isBot, parseDemoRequest } from "./service";

const valid = {
  schoolName: "Pwani Girls Secondary",
  county: "Mombasa",
  contactName: "Halima Omar",
  contactRole: "Principal",
  phone: "0712 345 678",
  email: "",
  studentCount: "640",
  schoolType: "boarding",
  message: "",
};

describe("parseDemoRequest", () => {
  it("accepts a complete request and normalises the phone", () => {
    expect(parseDemoRequest(valid)).toEqual({
      schoolName: "Pwani Girls Secondary",
      county: "Mombasa",
      contactName: "Halima Omar",
      contactRole: "Principal",
      phone: "+254712345678",
      email: null,
      studentCount: 640,
      schoolType: "boarding",
      message: null,
    });
  });

  it.each([
    ["schoolName", "", /school name/],
    ["phone", "123", /phone number/],
    ["email", "not-an-email", /email/],
    ["studentCount", "0", /how many students/],
    ["studentCount", "lots", /how many students/],
    ["schoolType", "online", /day, boarding or mixed/],
    ["message", "x".repeat(2001), /too long/],
  ])("rejects a bad %s", (field, value, message) => {
    const run = () => parseDemoRequest({ ...valid, [field]: value });
    expect(run).toThrow(ValidationError);
    expect(run).toThrow(message);
  });

  it("has no fields for children's details", () => {
    const parsed = parseDemoRequest({ ...valid, childName: "Should be ignored" });
    expect(Object.keys(parsed)).not.toContain("childName");
  });
});

describe("spam protection", () => {
  it("spots the honeypot", () => {
    expect(isBot({ website: "" })).toBe(false);
    expect(isBot({})).toBe(false);
    expect(isBot({ website: "http://spam.example" })).toBe(true);
  });

  it("hashes IP addresses instead of storing them", () => {
    const h = hashIp("196.201.214.10", "secret");
    expect(h).toHaveLength(64);
    expect(h).not.toContain("196.201");
    expect(hashIp("196.201.214.10", "secret")).toBe(h);
  });
});
