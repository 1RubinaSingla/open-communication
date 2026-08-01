import { ORCH_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OpenAI-compatible chat completions, proxied to the orchestrator (the single
 * source of inference truth). Streams SSE straight through for `stream: true`.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const body = await req.text();
  const upstream = await fetch(`${ORCH_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body,
  });

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
  headers.set("Cache-Control", "no-cache");
  return new Response(upstream.body, { status: upstream.status, headers });
}
