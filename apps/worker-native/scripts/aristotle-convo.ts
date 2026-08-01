/**
 * Multi-turn test: ask Aristotle something, then send a FOLLOW-UP in the same
 * conversation and confirm it continues the same project (real back-and-forth)
 * rather than starting over.
 */
import { io } from "socket.io-client";

const ORCH = process.env.ORCH ?? "https://0corchestrator-production.up.railway.app";
const CONVO = "convo-" + Date.now();

const auth = await fetch(`${ORCH}/auth/dev`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "convo-tester" }),
}).then((r) => r.json());

const s = io(`${ORCH}/infer`, { auth: { kind: "user", token: auth.token }, transports: ["polling", "websocket"] });
await new Promise<void>((r) => s.on("connect", () => r()));

function turn(label: string, content: string, history: any[]) {
  const jobId = `${CONVO}-${Date.now()}`;
  let text = "";
  const projects: string[] = [];
  const done = new Promise<any>((res) => {
    const onStep = (p: any) => {
      console.log(`  [${label}] ${p.text}`);
      const m = String(p.text).match(/project ([0-9a-f-]{36})/i);
      if (m) projects.push(m[1]);
    };
    const onTok = (p: any) => { text += p.delta; };
    const fin = (r: any) => { s.off("job.step", onStep); s.off("job.token", onTok); res(r); };
    s.on("job.step", onStep);
    s.on("job.token", onTok);
    s.once("job.done", (p: any) => fin({ done: p, text, projects }));
    s.once("job.error", (p: any) => fin({ error: p, text, projects }));
  });
  s.emit("job.submit", {
    jobId,
    model: "aristotle-verified",
    kind: "chat",
    conversationId: CONVO,
    messages: [...history, { role: "user", content }],
  });
  return done;
}

console.log("TURN 1: initial question");
const q1 = "Prove that for every natural number n, n + 0 = n.";
const r1: any = await turn("1", q1, []);
console.log("  answer:", (r1.text || "").slice(0, 160).replace(/\s+/g, " "));

console.log("\nTURN 2: follow-up in the SAME conversation");
const r2: any = await turn("2", "Now also prove that 0 + n = n.", [
  { role: "user", content: q1 },
  { role: "assistant", content: r1.text || "" },
]);
console.log("  answer:", (r2.text || "").slice(0, 160).replace(/\s+/g, " "));

const p1 = r1.projects[0];
const p2 = r2.projects[0];
console.log("\nproject turn1:", p1, "\nproject turn2:", p2);
const continued = !!p1 && p1 === p2;
console.log(continued ? "\n✓ SAME project reused — real multi-turn conversation" : "\n✗ different projects — follow-up did not continue");
s.close();
process.exit(continued ? 0 : 1);
