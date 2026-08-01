export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const CONTACT_EMAIL = "contact@opencommunication.app";

/**
 * Contact form handler.
 *
 * Sends the message server-side via Resend when RESEND_API_KEY is set. Without a
 * key it responds `configured: false`, and the client falls back to opening a
 * prefilled mail draft — so the form always works, with or without setup.
 */
export async function POST(req: Request) {
  let body: { name?: string; email?: string; subject?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const email = (body.email ?? "").trim().slice(0, 200);
  const subject = (body.subject ?? "").trim().slice(0, 200);
  const message = (body.message ?? "").trim().slice(0, 5000);

  if (!name || !email || !message) {
    return Response.json({ ok: false, error: "name, email and message are required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, error: "please enter a valid email address" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not configured: tell the client to fall back to a mail draft.
    return Response.json({ ok: false, configured: false, to: CONTACT_EMAIL }, { status: 200 });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM ?? "Open Communication <onboarding@resend.dev>",
        to: [process.env.CONTACT_TO ?? CONTACT_EMAIL],
        reply_to: email,
        subject: subject ? `[0_C] ${subject}` : `[0_C] New message from ${name}`,
        text: `From: ${name} <${email}>\nSubject: ${subject || "(none)"}\n\n${message}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json({ ok: false, configured: true, error: `mail provider error: ${detail.slice(0, 200)}` }, { status: 502 });
    }
    return Response.json({ ok: true, configured: true });
  } catch (e) {
    return Response.json(
      { ok: false, configured: true, error: e instanceof Error ? e.message : "send failed" },
      { status: 502 },
    );
  }
}
