/** Hit the REAL Aristotle API through the live orchestrator to confirm the wire shape. */
import { io } from "socket.io-client";

const ORCH = process.env.ORCH ?? "https://0corchestrator-production.up.railway.app";

const auth = await fetch(`${ORCH}/auth/dev`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "ar-live" }),
}).then((r) => r.json());

const s = io(`${ORCH}/infer`, { auth: { kind: "user", token: auth.token }, transports: ["polling", "websocket"] });
await new Promise<void>((r) => s.on("connect", () => r()));

let text = "";
const done = new Promise<any>((res) => {
  s.on("job.step", (p: any) => console.log("  step:", p.text));
  s.on("job.token", (p: any) => { text += p.delta; });
  s.on("job.done", (p: any) => res({ done: p }));
  s.on("job.error", (p: any) => res({ error: p }));
});

console.log("submitting real Aristotle job…");
s.emit("job.submit", {
  jobId: "arlive-" + Date.now(),
  model: "aristotle-verified",
  kind: "chat",
  messages: [{ role: "user", content: "What is 128 * 977?" }],
});

const r: any = await done;
console.log("RESULT:", JSON.stringify(r).slice(0, 500));
if (text) console.log("ANSWER:", text.slice(0, 400));
s.close();
process.exit(0);
