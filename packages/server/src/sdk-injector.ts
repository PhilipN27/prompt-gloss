// SdkInjector — the real @anthropic-ai/claude-agent-sdk session (ARCHITECTURE.md
// §3, §7, §9). One session per server process per project dir. Injection is
// delivered via the UserPromptSubmit hook's additionalContext, computed by the
// SAME pipeline the fake agent uses (computeInjection), so the matcher/budget
// path is identical in both modes; only this file touches the SDK.
//
// This wiring cannot be exercised in fake mode (the hook never fires there) — it
// is covered by the manual live smoke check described in ARCHITECTURE.md §9.

import { randomUUID } from "node:crypto";
import {
  query,
  type HookInput,
  type HookJSONOutput,
  type Options,
  type SDKMessage,
  type SDKUserMessage
} from "@anthropic-ai/claude-agent-sdk";
import { CardStore, InjectionLog, type BudgetOptions } from "@prompt-gloss/core";
import { computeInjection } from "./injection.js";
import { EventBus } from "./event-bus.js";
import type {
  AgentEvent,
  Injector,
  RecordedInjection,
  SendResult,
  SessionInfo
} from "./injector.js";

export interface SdkInjectorOptions {
  projectDir: string;
  budget: BudgetOptions;
  resumeSessionId: string | null;
  onSessionId: (id: string) => void;
}

const SYSTEM_APPEND =
  "When a message includes a <gloss-context> block, treat each <card> inside it " +
  "as authoritative background the user attached to a term in their message. It " +
  "is not part of their visible prompt.";

export interface SessionOptionsInput {
  projectDir: string;
  userPromptSubmitHook: (input: HookInput) => Promise<HookJSONOutput>;
  resumeSessionId: string | null;
  /** Injectable for tests; defaults to process.env. */
  parentEnv?: NodeJS.ProcessEnv;
}

/**
 * Build the SDK session Options. Coexistence with the Gloss file hook
 * (TERMINAL.md §4.5, Phase 0 finding) is armed here:
 *
 * - `env` REPLACES the subprocess environment (SDK doc), so the parent env is
 *   spread in — dropping the spread would strip PATH/HOME/ANTHROPIC_API_KEY.
 *   GLOSS_SKIP_HOOK=1 rides on top, scoped to this session only; process.env
 *   is never mutated (that would leak the flag to unrelated children).
 * - `settingSources` stays explicitly ["user","project","local"] — the CLI
 *   default — so the agent keeps loading CLAUDE.md and user/project/local
 *   settings. `settingSources: []` is rejected by the spec (§4.5).
 */
export function buildSessionOptions(input: SessionOptionsInput): Options {
  const parentEnv = input.parentEnv ?? process.env;
  return {
    cwd: input.projectDir,
    systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
    hooks: { UserPromptSubmit: [{ hooks: [input.userPromptSubmitHook] }] },
    env: { ...parentEnv, GLOSS_SKIP_HOOK: "1" },
    settingSources: ["user", "project", "local"],
    ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {})
  };
}

interface Pending {
  messageId: string;
  text: string;
  /** Injection precomputed in send(); the hook returns it verbatim. */
  payload: string;
  slugs: string[];
}

export class SdkInjector implements Injector {
  private readonly store: CardStore;
  private readonly log = new InjectionLog();
  private readonly bus = new EventBus<AgentEvent>();
  private readonly budget: BudgetOptions;
  private readonly projectDir: string;
  private readonly onSessionId: (id: string) => void;
  private readonly resumeSessionId: string | null;

  private sessionId: string | null;
  private readonly resumed: boolean;
  private recorded: RecordedInjection | null = null;

  /** The most-recent message awaiting its UserPromptSubmit hook (single-user). */
  private pending: Pending | null = null;

  /** Async generator the server pushes user messages into (streaming input). */
  private inputQueue: SDKUserMessage[] = [];
  private inputResolve: (() => void) | null = null;
  private started = false;

  constructor(opts: SdkInjectorOptions) {
    this.projectDir = opts.projectDir;
    this.budget = opts.budget;
    this.onSessionId = opts.onSessionId;
    this.resumeSessionId = opts.resumeSessionId;
    this.sessionId = opts.resumeSessionId;
    this.resumed = opts.resumeSessionId !== null;
    this.store = new CardStore(opts.projectDir);
  }

  session(): SessionInfo {
    return { id: this.sessionId, projectDir: this.projectDir, resumed: this.resumed };
  }

  private async *streamingInput(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (this.inputQueue.length > 0) {
        yield this.inputQueue.shift()!;
      }
      await new Promise<void>((resolve) => {
        this.inputResolve = resolve;
      });
    }
  }

  private pushInput(message: SDKUserMessage): void {
    this.inputQueue.push(message);
    if (this.inputResolve) {
      this.inputResolve();
      this.inputResolve = null;
    }
  }

  /** The UserPromptSubmit hook: return the injection precomputed in send() for
   * the pending message as additionalContext (invisible to the visible prompt).
   * If a prompt arrives without a matching pending entry (e.g. an SDK-internal
   * turn), compute on the fly as a fallback. */
  private userPromptSubmitHook = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "UserPromptSubmit") return {};
    const prompt = input.prompt;
    const pending = this.pending;
    let payload: string;
    if (pending && pending.text === prompt) {
      payload = pending.payload;
    } else {
      const computed = await computeInjection(prompt, this.store, this.log, this.budget);
      payload = computed.payload;
    }

    if (payload.length === 0) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: payload
      }
    };
  };

  private startSession(): void {
    if (this.started) return;
    this.started = true;

    const options = buildSessionOptions({
      projectDir: this.projectDir,
      userPromptSubmitHook: this.userPromptSubmitHook,
      resumeSessionId: this.resumeSessionId
    });

    const q = query({ prompt: this.streamingInput(), options });
    void this.consume(q);
  }

  private async consume(q: AsyncIterable<SDKMessage>): Promise<void> {
    try {
      for await (const event of q) {
        this.relay(event);
      }
    } catch (err) {
      this.bus.publish({
        type: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private relay(event: SDKMessage): void {
    if (event.type === "system" && event.subtype === "init") {
      this.sessionId = event.session_id;
      this.onSessionId(event.session_id);
      this.bus.publish({ type: "system", subtype: "init", sessionId: event.session_id });
      return;
    }
    if (event.type === "assistant") {
      const messageId = this.pending?.messageId ?? event.session_id;
      for (const block of event.message.content) {
        if (block.type === "text") {
          this.bus.publish({ type: "assistant_delta", messageId, text: block.text });
        } else if (block.type === "tool_use") {
          this.bus.publish({ type: "tool", messageId, name: block.name });
        }
      }
      return;
    }
    if (event.type === "result") {
      const messageId = this.pending?.messageId ?? "";
      this.bus.publish({ type: "assistant_done", messageId });
    }
  }

  async send(text: string): Promise<SendResult> {
    this.startSession();
    const messageId = randomUUID();

    // Compute the injection once, here, so the POST response, the SSE indicator,
    // the debug record, and the hook's additionalContext all agree (and the
    // session-dedup log is advanced exactly once per message).
    const { payload, slugs } = await computeInjection(
      text,
      this.store,
      this.log,
      this.budget
    );
    this.pending = { messageId, text, payload, slugs };
    this.recorded = { messageId, payload, slugs };
    if (slugs.length > 0) {
      this.bus.publish({ type: "injection", messageId, slugs });
    }

    this.pushInput({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null
    });

    return { messageId, slugs };
  }

  events(): AsyncIterable<AgentEvent> {
    return this.bus.subscribe();
  }

  lastInjection(): RecordedInjection | null {
    return this.recorded;
  }

  async close(): Promise<void> {
    this.bus.close();
    if (this.inputResolve) {
      this.inputResolve();
      this.inputResolve = null;
    }
    return Promise.resolve();
  }
}
