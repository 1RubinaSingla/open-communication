/** End-to-end image job: submit → worker renders → media relayed → 20 cr billed. */
import { io } from "socket.io-client";

const ORCH = process.env.ORCH ?? "http://localhost:4100";

async function main() {
  const auth = await fetch(`${ORCH}/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "imguser" }),
  }).then((r) => r.json());

  const before = await fetch(`${ORCH}/me`, { headers: { Authorization: `Bearer ${auth.token}` } })
    .then((r) => r.json())
    .then((d) => d.balance);

  const socket = io(`${ORCH}/infer`, { auth: { kind: "user", token: auth.token }, transports: ["websocket"] });
  await new Promise<void>((r) => socket.on("connect", () => r()));

  const jobId = "img-test-" + Math.floor(before);
  let media: { mimeType: string; dataUrl: string } | null = null;

  const done = new Promise<any>((resolve) => {
    socket.on("job.media", (p: any) => (media = { mimeType: p.mimeType, dataUrl: p.dataUrl }));
    socket.on("job.done", (p: any) => resolve(p));
    socket.on("job.error", (p: any) => resolve({ error: p.message }));
  });

  socket.emit("job.submit", {
    jobId,
    model: "stub-diffusion",
    kind: "image",
    messages: [{ role: "user", content: "a neon cyberpunk city at night" }],
  });

  const result = await done;

  let pass = true;
  const check = (name: string, ok: boolean) => {
    console.log(`   ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) pass = false;
  };
  check("received media frame", media !== null);
  check("media is an image data URL", !!media && media!.dataUrl.startsWith("data:image/svg+xml;base64,"));
  check("job settled with flat charge = 20", result.charge === 20);
  check("balance debited by 20", result.balance === before - 20);
  check("served by a worker", !!result.servedBy);

  socket.close();
  console.log("\n" + (pass ? "OK — image pipeline verified." : "FAIL — see above."));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
