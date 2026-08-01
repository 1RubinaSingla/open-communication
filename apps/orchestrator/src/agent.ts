import type { Namespace, Socket } from "socket.io";
import { Ev, type ChatMessage } from "@0c/protocol";
import { agentCost, estimateTokens } from "@0c/credits";
import { InsufficientCreditsError, type Db } from "@0c/db";
import type { WorkerRegistry } from "./registry.js";
import type { JobSink } from "./engine.js";
import { TOOL_DEFS, executeTool, toolLabel } from "./tools.js";

const MAX_ITERS = 5;

function emitAck(socket: Socket, ev: string, payload: unknown, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(ev, payload, (err: unknown, res: any) => {
      resolve(err ? { ok: false, error: "worker timeout" } : res);
    });
  });
}

/**
 * Runs a tool-using agent: the model may call tools, which execute centrally on
 * the orchestrator (never on contributor machines). Loops model↔tools until the
 * model produces a final answer, streaming each tool step to the caller.
 */
export class AgentEngine {
  constructor(
    private db: Db,
    private workers: WorkerRegistry,
    private _infer: Namespace,
  ) {}

  async run(params: { userId: string; jobId: string; model: string; messages: ChatMessage[]; sink: JobSink }) {
    const { userId, jobId, model, messages, sink } = params;
    const reserve = agentCost();
    try {
      this.db.reserve(userId, jobId, reserve, model);
    } catch (err) {
      const msg = err instanceof InsufficientCreditsError ? err.message : "reserve failed";
      sink.onError({ message: msg, refunded: false });
      return;
    }

    const worker = this.workers.pickIdle(model, "agent");
    if (!worker) {
      this.db.refund(userId, jobId, reserve);
      sink.onError({ message: `no agent-capable worker for ${model} (needs Ollama tool-calling)`, refunded: true });
      return;
    }
    worker.busy = true;

    const convo: any[] = [
      { role: "system", content: "You are a helpful assistant with tools. Use web_search for facts you're unsure of and calculator for math. Think step by step, then answer concisely." },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      let finalText = "";
      for (let i = 0; i < MAX_ITERS; i++) {
        const turn = await emitAck(worker.socket, Ev.agentTurn, { model, messages: convo, tools: TOOL_DEFS });
        if (!turn?.ok) throw new Error(turn?.error || "agent turn failed");
        const msg = turn.message ?? {};
        const calls: any[] = msg.tool_calls ?? [];
        if (calls.length === 0) {
          finalText = msg.content || "";
          break;
        }
        convo.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
        for (const c of calls) {
          const name = c.function?.name ?? "";
          let args = c.function?.arguments ?? {};
          if (typeof args === "string") {
            try { args = JSON.parse(args); } catch { args = { value: args }; }
          }
          sink.onStep?.(`🔧 ${toolLabel(name, args)}`);
          const result = await executeTool(name, args, (p) => sink.onStep?.(`   ${p}`));
          sink.onStep?.(`↳ ${result.slice(0, 160)}`);
          convo.push({ role: "tool", name, content: result });
        }
      }
      if (!finalText) finalText = "(the agent reached its step limit without a final answer)";

      worker.busy = false;
      const usage = {
        promptTokens: messages.reduce((n, m) => n + estimateTokens(m.content), 0),
        completionTokens: estimateTokens(finalText),
      };
      const settled = this.db.settle(userId, jobId, reserve, model, usage, worker.name, agentCost());
      sink.onToken(0, finalText);
      sink.onDone({ usage, charge: settled.charge, balance: settled.balance, servedBy: worker.name });
    } catch (err) {
      worker.busy = false;
      this.db.refund(userId, jobId, reserve);
      sink.onError({ message: err instanceof Error ? err.message : "agent failed", refunded: true });
    }
  }
}
