"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GatePass } from "@/lib/leaveout/gate";
import { parsePass, pickupCodeHash, verifyPass } from "@/lib/leaveout/pass-token";
import { REASON_TEXT, type Verdict, passVerdict, timeOfDay, whenText } from "@/lib/leaveout/rules";
import { decodeFile, decodeQr, preloadDecoder } from "./decode";
import {
  type Bundle,
  type QueuedEvent,
  dequeue,
  enqueue,
  loadBundle,
  queued,
  saveBundle,
} from "./gate-store";

type Shown = { pass: GatePass | null; verdict: Verdict; note?: string };

const bigButton =
  "flex h-16 w-full items-center justify-center rounded-2xl px-5 text-xl font-bold disabled:opacity-50";

/**
 * The gate screen (gate guard, phone first, readable in sunlight): scan the QR code (or a photo
 * of it, or search by name), see the photo and a clear VALID / NOT VALID, enter the collector's
 * pickup code, mark the exit; scan again on return. Works offline from the downloaded passes and
 * sends exits and returns when the connection is back.
 */
export function GateApp({ schoolName }: { schoolName: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [online, setOnline] = useState(true);
  const [view, setView] = useState<"home" | "camera" | "result" | "search">("home");
  const [shown, setShown] = useState<Shown | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [fast, setFast] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<GatePass[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const syncing = useRef(false);

  const refreshQueue = useCallback(async () => setQueue(await queued()), []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/gate/bundle", { cache: "no-store" });
      if (res.status === 401) {
        setMessage({ tone: "error", text: "Signed out. Sign in again to download passes." });
        return;
      }
      if (!res.ok) return;
      const b = (await res.json()) as Bundle;
      await saveBundle(b);
      setBundle(b);
    } catch {
      // offline: keep the passes already on the phone
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      const events = await queued();
      if (!events.length) return;
      const res = await fetch("/api/gate/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
      if (!res.ok) return;
      const { results } = (await res.json()) as {
        results: { id: string; ok: boolean; conflict?: string; error?: string }[];
      };
      const notes: string[] = [];
      for (const r of results) {
        await dequeue(r.id);
        const e = events.find((x) => x.id === r.id);
        const who = bundle?.passes.find((p) => p.id === e?.leaveoutId)?.studentName ?? "A student";
        if (r.conflict) notes.push(`${who}: recorded, but ${r.conflict}`);
        if (r.error) notes.push(`${who}: NOT recorded. ${r.error}`);
      }
      if (notes.length) setProblems((p) => [...notes, ...p].slice(0, 10));
      await refresh();
    } catch {
      // still offline: try again later
    } finally {
      syncing.current = false;
      await refreshQueue();
    }
  }, [bundle, refresh, refreshQueue]);

  useEffect(() => {
    preloadDecoder();
    void (async () => {
      setBundle((await loadBundle()) ?? null);
      await refreshQueue();
      setOnline(navigator.onLine);
      await refresh();
      await sync();
    })();
    const on = () => {
      setOnline(true);
      void sync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t1 = setInterval(() => void sync(), 30_000);
    const t2 = setInterval(() => void refresh(), 5 * 60_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t1);
      clearInterval(t2);
    };
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A pass as the phone knows it: exits and returns not yet sent count too. */
  const withQueue = useCallback(
    (p: GatePass): GatePass => {
      const mine = queue.filter((e) => e.leaveoutId === p.id);
      if (mine.some((e) => e.kind === "return")) return { ...p, status: "returned" };
      if (mine.some((e) => e.kind === "exit") && p.status === "approved")
        return { ...p, status: "out" };
      return p;
    },
    [queue],
  );

  const show = useCallback(
    (pass: GatePass | null, note?: string, forced?: Verdict) => {
      const p = pass ? withQueue(pass) : null;
      setShown({ pass: p, verdict: forced ?? passVerdict(p, new Date()), note });
      setCode("");
      setMessage(null);
      setView("result");
    },
    [withQueue],
  );

  const handleToken = useCallback(
    async (token: string) => {
      const parsed = parsePass(token);
      const notFound: Verdict = { valid: false, reason: "not_found" };
      if (!parsed) return show(null, "This is not a Kiota pass.", notFound);
      if (bundle && parsed.schoolId !== bundle.school.id)
        return show(null, "This pass is for another school.", notFound);
      if (bundle?.publicKey && (await verifyPass(token, bundle.publicKey)) === "invalid")
        return show(null, "Forged or damaged pass: the signature does not match.", notFound);
      let pass = bundle?.passes.find((p) => p.id === parsed.leaveoutId) ?? null;
      if (navigator.onLine) {
        try {
          const res = await fetch(`/api/gate/pass?token=${encodeURIComponent(token)}`, {
            cache: "no-store",
          });
          if (res.ok) pass = ((await res.json()) as { pass: GatePass | null }).pass;
        } catch {
          // use the downloaded copy
        }
      }
      if (pass && pass.nonce && pass.nonce !== parsed.nonce)
        return show(null, "An old pass: a newer one was issued for this leave-out.", notFound);
      if (!pass)
        return show(
          null,
          bundle?.publicKey
            ? "A genuine pass, but it is not on this phone. Connect to the internet and scan again."
            : undefined,
          notFound,
        );
      show(pass);
    },
    [bundle, show],
  );

  // ---- Camera ----
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setMessage(null);
    setView("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();
      const tick = async () => {
        if (!streamRef.current) return;
        const text = await decodeQr(v).catch(() => null);
        if (text) {
          stopCamera();
          await handleToken(text);
          return;
        }
        setTimeout(() => void tick(), 250);
      };
      void tick();
    } catch {
      setView("home");
      setMessage({
        tone: "error",
        text: "The camera did not open. Allow the camera (it needs https or localhost), or use a photo, or search by name.",
      });
    }
  }, [handleToken, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const text = await decodeFile(file).catch(() => null);
    setBusy(false);
    if (!text) {
      setMessage({
        tone: "error",
        text: "No QR code found in that photo. Try again closer, or search by name.",
      });
      return;
    }
    await handleToken(text);
  }

  // ---- Search ----
  async function search(q: string) {
    setQuery(q);
    const term = q.trim().toLowerCase();
    if (term.length < 2) return setFound([]);
    const local = (bundle?.passes ?? []).filter(
      (p) =>
        p.studentName.toLowerCase().includes(term) ||
        p.admissionNumber.toLowerCase().includes(term),
    );
    setFound(local.slice(0, 10));
    if (navigator.onLine) {
      try {
        const res = await fetch(`/api/gate/pass?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (res.ok) {
          const { passes } = (await res.json()) as { passes: GatePass[] };
          const seen = new Set(local.map((p) => p.id));
          setFound([...local, ...passes.filter((p) => !seen.has(p.id))].slice(0, 10));
        }
      } catch {
        // offline results only
      }
    }
  }

  // ---- Exit and return ----
  async function record(kind: "exit" | "return") {
    const p = shown?.pass;
    if (!p) return;
    setBusy(true);
    try {
      if (kind === "exit") {
        if (!/^\d{4}$/.test(code) || (await pickupCodeHash(p.id, code)) !== p.pickupCodeHash) {
          setMessage({
            tone: "error",
            text: "Wrong pickup code. Ask the collector for the 4-digit code from their SMS.",
          });
          return;
        }
      }
      const event: QueuedEvent = {
        id: crypto.randomUUID(),
        leaveoutId: p.id,
        kind,
        at: new Date().toISOString(),
        code: kind === "exit" ? code : undefined,
        offline: !navigator.onLine,
      };
      await enqueue(event);
      await refreshQueue();
      const time = new Date().toLocaleTimeString("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      // Done with this pass: back to the start, with the green confirmation.
      setShown(null);
      setView("home");
      setMessage({
        tone: "ok",
        text: `${kind === "exit" ? "Exit" : "Return"} recorded at ${time}.${navigator.onLine ? "" : " It will be sent when the phone is online."}`,
      });
      void sync();
      if (fast) setTimeout(() => void startCamera(), 1500);
    } finally {
      setBusy(false);
    }
  }

  const v = shown?.verdict;
  const p = shown?.pass;

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 text-sm"
        data-testid="gate-status"
      >
        <span className="flex items-center gap-2 font-semibold">
          <span
            className={`size-3 rounded-full ${online ? "bg-status-paid" : "bg-status-overdue"}`}
            aria-hidden
          />
          {online ? "Online" : "Offline"}
        </span>
        <span>
          {bundle
            ? `${bundle.passes.length} passes · updated ${timeOfDay(bundle.generatedAt)}`
            : "No passes yet"}
        </span>
        {queue.length ? (
          <span className="font-semibold text-status-due">{queue.length} to send</span>
        ) : null}
        <button
          type="button"
          onClick={() => void refresh().then(sync)}
          className="h-10 rounded-lg px-3 font-semibold text-teal"
        >
          Refresh
        </button>
      </div>

      <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4">
        <input
          type="checkbox"
          checked={fast}
          onChange={(e) => setFast(e.target.checked)}
          className="size-6 accent-teal"
        />
        <span className="font-semibold">Half-term mode</span>
        <span className="text-sm text-ink/60">camera opens again after each exit</span>
      </label>

      {problems.length ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-2xl bg-status-overdue/10 p-3 text-sm text-status-overdue"
        >
          {problems.map((x, i) => (
            <p key={i}>{x}</p>
          ))}
          <button
            type="button"
            className="self-start font-semibold underline"
            onClick={() => setProblems([])}
          >
            Clear
          </button>
        </div>
      ) : null}

      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-2xl p-4 text-lg font-semibold ${message.tone === "error" ? "bg-status-overdue text-white" : "bg-status-paid text-white"}`}
        >
          {message.text}
        </p>
      ) : null}

      {view === "camera" ? (
        <div className="flex flex-col gap-3">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-square w-full rounded-2xl bg-ink object-cover"
          />
          <button
            type="button"
            className={`${bigButton} border-2 border-ink/20 bg-white text-ink`}
            onClick={() => {
              stopCamera();
              setView("home");
            }}
          >
            Stop
          </button>
        </div>
      ) : null}

      {view === "result" && v ? (
        <section className="flex flex-col gap-4" aria-label="Pass">
          <div
            data-testid="verdict"
            className={`rounded-2xl p-5 text-center ${v.valid ? "bg-status-paid" : "bg-status-overdue"} text-white`}
          >
            <p className="font-heading text-4xl font-bold">{v.valid ? "VALID" : "NOT VALID"}</p>
            <p className="text-xl font-semibold">
              {v.valid
                ? v.action === "exit"
                  ? "Leaving"
                  : v.late
                    ? "Coming back (late)"
                    : "Coming back"
                : (shown?.note ?? REASON_TEXT[v.reason])}
            </p>
          </div>
          {p ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
              {p.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- downloaded photo (offline)
                <img
                  src={p.photo}
                  alt={p.studentName}
                  className="max-h-80 w-full rounded-xl object-cover"
                />
              ) : (
                <p className="rounded-xl bg-status-due/15 p-4 text-center font-semibold text-status-due">
                  No photo on file: check the student carefully
                </p>
              )}
              <p className="font-heading text-3xl leading-tight font-bold">{p.studentName}</p>
              <p className="text-xl">
                {p.classLabel} · {p.admissionNumber}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-lg">
                <dt className="text-ink/60">With</dt>
                <dd className="font-semibold">
                  {p.collectorName} ({p.collectorRelationship})
                </dd>
                <dt className="text-ink/60">Leaves</dt>
                <dd>{whenText(p.leaveAt)}</dd>
                <dt className="text-ink/60">Back by</dt>
                <dd>{whenText(p.returnAt)}</dd>
                {p.approvedBy ? (
                  <>
                    <dt className="text-ink/60">Approved</dt>
                    <dd>{p.approvedBy}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}
          {p && v.valid && v.action === "exit" ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void record("exit");
              }}
            >
              <label htmlFor="pickup" className="text-lg font-semibold">
                Collector&apos;s pickup code
              </label>
              <input
                id="pickup"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="h-16 rounded-2xl border-2 border-ink/30 bg-white text-center font-heading text-4xl tracking-[0.5em]"
                placeholder="0000"
              />
              <button
                type="submit"
                disabled={busy || code.length !== 4}
                className={`${bigButton} bg-teal text-white`}
              >
                Mark exit
              </button>
            </form>
          ) : null}
          {p && v.valid && v.action === "return" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void record("return")}
              className={`${bigButton} bg-teal text-white`}
            >
              Mark return
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void startCamera()}
            className={`${bigButton} border-2 border-teal bg-white text-teal`}
          >
            Scan next
          </button>
        </section>
      ) : null}

      {view === "search" ? (
        <section className="flex flex-col gap-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => void search(e.target.value)}
            placeholder="Name or admission number"
            aria-label="Name or admission number"
            className="h-14 rounded-2xl border-2 border-ink/30 bg-white px-4 text-xl"
          />
          <ul className="flex flex-col gap-2">
            {found.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => show(f)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white p-3 text-left"
                >
                  {f.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- downloaded photo
                    <img src={f.photo} alt="" className="size-12 rounded-full object-cover" />
                  ) : null}
                  <span className="flex flex-col">
                    <span className="text-lg font-semibold">{f.studentName}</span>
                    <span className="text-ink/60">
                      {f.classLabel} · {f.admissionNumber}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view !== "camera" ? (
        <div className="flex flex-col gap-3">
          {view !== "result" ? (
            <button
              type="button"
              onClick={() => void startCamera()}
              className={`${bigButton} bg-teal text-white`}
            >
              Scan pass
            </button>
          ) : null}
          <label className={`${bigButton} cursor-pointer border-2 border-ink/20 bg-white text-ink`}>
            Use a photo of the pass
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Photo of the pass"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // the same photo again (on return) must still count
                void onPhoto(file);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setView("search");
              setFound([]);
              setQuery("");
            }}
            className={`${bigButton} border-2 border-ink/20 bg-white text-ink`}
          >
            Search by name
          </button>
        </div>
      ) : null}
      <p className="text-center text-sm text-ink/50">{schoolName} gate</p>
    </div>
  );
}
