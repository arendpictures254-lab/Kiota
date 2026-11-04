import "server-only";

/**
 * Shared wrapper for the Daraja callback routes: reads JSON safely, answers in Daraja's format,
 * never leaks errors, and always answers 200 for known schools so Safaricom does not retry
 * forever (idempotency makes retries harmless anyway).
 */
export function mpesaRoute(
  handler: (
    token: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any,
  ) => Promise<{ status: 200 | 404; body?: unknown; outcome?: string | null }>,
) {
  return async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
    const { token } = await ctx.params;
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    try {
      const result = await handler(token, body);
      if (result.status === 404) return new Response("Not found", { status: 404 });
      return Response.json(result.body ?? { ResultCode: "0", ResultDesc: "Accepted" });
    } catch (err) {
      console.error("[mpesa] callback failed", err);
      // Tell Safaricom to try again later.
      return Response.json({ ResultCode: "1", ResultDesc: "Temporary error" }, { status: 500 });
    }
  };
}
