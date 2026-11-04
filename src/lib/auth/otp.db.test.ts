import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SmsMessage } from "@/lib/sms";
import { app, makeMember, makeSchool, owner, randomPhone } from "../../../tests/db-helpers";
import { OTP_MAX_ATTEMPTS, OTP_TTL_MS, createOtpService } from "./otp";

let schoolId: string;

beforeAll(async () => {
  schoolId = (await makeSchool(`OTP ${Date.now()}`)).id;
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

function setup(start = new Date()) {
  let clock = start.getTime();
  const sent: SmsMessage[] = [];
  const otp = createOtpService({
    db: app,
    secret: "test-secret",
    sendSms: async (m) => {
      sent.push(m);
    },
    now: () => new Date(clock),
  });
  const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.text)![1];
  return { otp, sent, lastCode, advance: (ms: number) => (clock += ms) };
}

async function staffPhone() {
  const { user } = await makeMember(schoolId, ["bursar"]);
  return user.phone;
}

describe("OTP sign-in", () => {
  it("sends a 6-digit code by SMS and signs in with it", async () => {
    const phone = await staffPhone();
    const { otp, sent, lastCode } = setup();
    expect(await otp.requestCode(phone)).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(phone);
    expect(lastCode()).toMatch(/^\d{6}$/);

    const result = await otp.verifyCode(phone, lastCode());
    expect(result.ok).toBe(true);
  });

  it("stores only a hash of the code", async () => {
    const phone = await staffPhone();
    const { otp, lastCode } = setup();
    await otp.requestCode(phone);
    const row = await owner.otpCode.findFirstOrThrow({ where: { phone } });
    expect(row.codeHash).not.toContain(lastCode());
    expect(row.codeHash).toHaveLength(64);
  });

  it("does not send codes to numbers no school has added", async () => {
    const { otp, sent } = setup();
    expect(await otp.requestCode(randomPhone())).toEqual({ ok: false, reason: "unknown_phone" });
    expect(sent).toHaveLength(0);
  });

  it("a code can only be used once", async () => {
    const phone = await staffPhone();
    const { otp, lastCode } = setup();
    await otp.requestCode(phone);
    const code = lastCode();
    expect((await otp.verifyCode(phone, code)).ok).toBe(true);
    expect(await otp.verifyCode(phone, code)).toEqual({ ok: false, reason: "no_code" });
  });

  it("codes expire after 5 minutes", async () => {
    const phone = await staffPhone();
    const { otp, lastCode, advance } = setup();
    await otp.requestCode(phone);
    advance(OTP_TTL_MS + 1);
    expect(await otp.verifyCode(phone, lastCode())).toEqual({ ok: false, reason: "no_code" });
  });

  it("allows 5 attempts, then blocks the code even if the right one is typed", async () => {
    const phone = await staffPhone();
    const { otp, lastCode } = setup();
    await otp.requestCode(phone);
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";

    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await otp.verifyCode(phone, wrong)).toEqual({
        ok: false,
        reason: "wrong_code",
        attemptsLeft: OTP_MAX_ATTEMPTS - i,
      });
    }
    expect(await otp.verifyCode(phone, wrong)).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(await otp.verifyCode(phone, right)).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("a new code replaces the previous one", async () => {
    const phone = await staffPhone();
    const { otp, lastCode } = setup();
    await otp.requestCode(phone);
    const first = lastCode();
    await otp.requestCode(phone);
    const second = lastCode();
    if (first !== second) {
      expect((await otp.verifyCode(phone, first)).ok).toBe(false);
    }
    expect((await otp.verifyCode(phone, second)).ok).toBe(true);
  });

  it("rate-limits to 3 codes per phone per 15 minutes", async () => {
    const phone = await staffPhone();
    const { otp, sent, advance } = setup();
    for (let i = 0; i < 3; i++) expect((await otp.requestCode(phone)).ok).toBe(true);
    expect(await otp.requestCode(phone)).toEqual({ ok: false, reason: "rate_limited" });
    expect(sent).toHaveLength(3);
    advance(15 * 60 * 1000 + 1);
    expect((await otp.requestCode(phone)).ok).toBe(true);
  });
});
