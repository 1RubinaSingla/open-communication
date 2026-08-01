/**
 * Harmonic Aristotle adapter — formally-verified mathematical reasoning.
 *
 * PRIVACY NOTE: this is the one path in 0_C where a prompt LEAVES the network.
 * Aristotle is a third-party API (Harmonic), so any problem sent here is
 * transmitted to them under their terms. Every call site labels this; see the
 * whitepaper's privacy section.
 *
 * Wire contract matches Harmonic's official `aristotlelib` SDK v2.1.0:
 *   base    https://aristotle.harmonic.fun/api/v3
 *   auth    X-API-Key: <key>
 *   submit  POST /project        multipart form, field `body` = JSON string
 *   poll    GET  /project/{id}/tasks     -> AgentTask[] (status, output_summary)
 *   detail  GET  /task/{taskId}/events   -> Event[] (content) when no summary
 *
 * Aristotle is an *agent* that can run for minutes (and, on real proof projects,
 * far longer) — not a fast Q&A endpoint. We poll until ARISTOTLE_TIMEOUT_MS and
 * return a clear timeout rather than blocking a chat forever.
 */

export interface AristotleConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface AristotleResult {
  ok: boolean;
  text?: string;
  verified?: boolean;
  jobId?: string;
  /** The Aristotle project — persist it to continue this conversation later. */
  projectId?: string;
  error?: string;
}

/** Terminal task states, per the SDK's TaskStatus enum. */
const TERMINAL = new Set(["COMPLETE", "COMPLETE_WITH_ERRORS", "OUT_OF_BUDGET", "FAILED", "CANCELED"]);
const BAD = new Set(["FAILED", "CANCELED"]);
/** Event types whose `content` reads as the agent's answer: MESSAGE, FINISHED, SUMMARY. */
const TEXT_EVENTS = new Set([1, 10, 16]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeAristotle(cfg: AristotleConfig) {
  const enabled = !!cfg.apiKey;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const headers = { "X-API-Key": cfg.apiKey };

  async function getJson(path: string): Promise<any> {
    const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    return res.json();
  }

  /** Best-effort text for a finished task: its summary, else its message events. */
  async function textForTask(task: any): Promise<string | undefined> {
    if (task?.output_summary) return String(task.output_summary).trim();
    try {
      const events = await getJson(`/task/${task.agent_task_id}/events`);
      const list: any[] = Array.isArray(events) ? events : (events?.events ?? events?.data ?? []);
      const parts = list
        .filter((e) => TEXT_EVENTS.has(Number(e?.event_type)))
        .map((e) => String(e?.content ?? "").trim())
        .filter(Boolean);
      if (parts.length) return parts.join("\n\n");
    } catch {
      /* fall through */
    }
    return undefined;
  }

  /** Human labels for Aristotle's event types, for live progress. */
  const EVENT_LABEL: Record<number, string> = {
    2: "building", 3: "thinking", 4: "editing file", 5: "searching",
    6: "running command", 7: "proving", 8: "reading files", 9: "reviewing",
    10: "finished", 11: "error", 12: "reading Lean", 13: "searching external", 14: "running Lean",
  };

  /** Start a brand-new project from a prompt. Returns its id. */
  async function createProject(prompt: string): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
    try {
      const form = new FormData();
      form.append("body", JSON.stringify({ prompt, agent_questions_setting: 1 })); // 1 = DISABLED
      const res = await fetch(`${base}/project`, {
        method: "POST",
        headers, // no content-type: fetch sets the multipart boundary
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.text();
      if (!res.ok) return { ok: false, error: `Aristotle API ${res.status}: ${body.slice(0, 200)}` };
      const projectId = JSON.parse(body)?.project_id;
      return projectId ? { ok: true, projectId } : { ok: false, error: "Aristotle returned no project_id" };
    } catch (e) {
      return { ok: false, error: `Aristotle request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Continue an existing project — this is what makes a real back-and-forth
   * conversation possible instead of one-shot questions. mode 2 = INSTRUCT
   * (redirect / start a new task), mode 1 = ASK (question the last result).
   */
  async function askProject(
    projectId: string,
    prompt: string,
    mode: 1 | 2 = 2,
  ): Promise<{ ok: true; taskId?: string } | { ok: false; error: string }> {
    try {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("mode", String(mode));
      form.append("agent_questions_setting", "1");
      const res = await fetch(`${base}/project/${projectId}/ask`, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.text();
      if (!res.ok) return { ok: false, error: `Aristotle ask ${res.status}: ${body.slice(0, 200)}` };
      let taskId: string | undefined;
      try {
        taskId = JSON.parse(body)?.agent_task_id;
      } catch {
        /* body may be empty */
      }
      return { ok: true, taskId };
    } catch (e) {
      return { ok: false, error: `Aristotle ask failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Solve a problem. Pass `projectId` to continue an existing conversation
   * instead of starting fresh. Never throws — always resolves to a result or a
   * clear error. `onProgress` streams live agent reasoning to the caller.
   */
  async function solve(
    problem: string,
    onProgress?: (s: string) => void,
    existingProjectId?: string,
  ): Promise<AristotleResult> {
    if (!enabled) return { ok: false, error: "verified math is not configured (no ARISTOTLE_API_KEY)" };
    const deadline = Date.now() + cfg.timeoutMs;

    let projectId: string;
    let sinceTaskId: string | undefined;
    if (existingProjectId) {
      const asked = await askProject(existingProjectId, problem, 2);
      if (!asked.ok) return { ok: false, error: asked.error };
      projectId = existingProjectId;
      sinceTaskId = asked.taskId;
      onProgress?.(`continuing project ${projectId} — Aristotle is thinking`);
    } else {
      const created = await createProject(problem);
      if (!created.ok) return { ok: false, error: created.error };
      projectId = created.projectId;
      onProgress?.(`project ${projectId} created — Aristotle is working`);
    }

    // 2) poll the project's tasks until one reaches a terminal state, streaming
    //    the agent's activity so a multi-minute proof doesn't look frozen.
    let delay = 3000;
    let lastNote = "";
    const seenEvents = new Set<string>();
    while (Date.now() < deadline) {
      await sleep(delay);
      delay = Math.min(delay * 1.4, 15_000);
      try {
        const raw = await getJson(`/project/${projectId}/tasks`);
        // SDK returns {"agent_tasks": [...]}
        const tasks: any[] = Array.isArray(raw) ? raw : (raw?.agent_tasks ?? raw?.tasks ?? raw?.data ?? []);
        if (!tasks.length) continue;
        // On a follow-up, watch the task the ask() created; otherwise the newest.
        const byId = sinceTaskId ? tasks.find((t) => t?.agent_task_id === sinceTaskId) : undefined;
        const task =
          byId ??
          [...tasks].sort(
            (a, b) => new Date(a?.created_at ?? 0).getTime() - new Date(b?.created_at ?? 0).getTime(),
          )[tasks.length - 1];
        const status = String(task?.status ?? "").toUpperCase();

        if (!TERMINAL.has(status)) {
          // stream progress: percent + newest activity
          const pct = typeof task?.percent_complete === "number" ? ` ${task.percent_complete}%` : "";
          const note = `${status.toLowerCase()}${pct}`;
          if (note !== lastNote) {
            lastNote = note;
            onProgress?.(note);
          }
          try {
            const ev = await getJson(`/task/${task.agent_task_id}/events`);
            const list: any[] = Array.isArray(ev) ? ev : (ev?.events ?? ev?.data ?? []);
            for (const e of list.slice(-3)) {
              const id = String(e?.event_id ?? "");
              if (!id || seenEvents.has(id)) continue;
              seenEvents.add(id);
              const label = EVENT_LABEL[Number(e?.event_type)] ?? "working";
              const snippet = String(e?.content ?? "").trim().slice(0, 90);
              onProgress?.(snippet ? `${label}: ${snippet}` : label);
            }
          } catch {
            /* progress is best-effort */
          }
          continue;
        }

        if (BAD.has(status)) return { ok: false, error: `Aristotle task ${status}`, jobId: projectId, projectId };
        const text = await textForTask(task);
        if (!text) return { ok: false, error: `Aristotle finished (${status}) but returned no summary`, jobId: projectId, projectId };
        return { ok: true, text, verified: status === "COMPLETE", jobId: projectId, projectId };
      } catch {
        /* transient — keep polling until the deadline */
      }
    }
    return {
      ok: false,
      error: `Aristotle still working after ${Math.round(cfg.timeoutMs / 1000)}s (project ${projectId})`,
      jobId: projectId,
      projectId,
    };
  }

  return { enabled, solve, createProject, askProject };
}

/**
 * Public link to an Aristotle project's full transcript (reasoning, edits,
 * proofs). Note: Harmonic's dashboard may require a session, so this can be
 * owner-only. Override the host with ARISTOTLE_DASHBOARD_URL if it changes.
 */
export function aristotleTranscriptUrl(projectId: string): string {
  const base = (process.env.ARISTOTLE_DASHBOARD_URL ?? "https://aristotle.harmonic.fun/dashboard/requests").replace(/\/+$/, "");
  return `${base}/${projectId}`;
}

export function aristotleConfigFromEnv(): AristotleConfig {
  return {
    apiKey: process.env.ARISTOTLE_API_KEY ?? "",
    baseUrl: process.env.ARISTOTLE_BASE_URL ?? "https://aristotle.harmonic.fun/api/v3",
    // Aristotle is a proof agent: even small problems take minutes. Progress is
    // streamed while it works, so a longer window is tolerable.
    timeoutMs: Number(process.env.ARISTOTLE_TIMEOUT_MS ?? 900_000),
  };
}
