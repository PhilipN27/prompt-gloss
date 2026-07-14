// FakeInjector (GLOSS_FAKE_AGENT=1). Replaces ONLY the Claude Agent SDK call
// with a scripted responder. Everything else — store, matcher, budget,
// injection formatting, indicator data — is the real code path. It records the
// exact injected payload for GET /api/debug/last-injection so tests can assert
// on what would have reached Claude (TESTING.md → Fake agent mode).

import { randomUUID } from "node:crypto";
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

export interface FakeInjectorOptions {
  projectDir: string;
  budget: BudgetOptions;
}

export class FakeInjector implements Injector {
  private readonly store: CardStore;
  private readonly log = new InjectionLog();
  private readonly bus = new EventBus<AgentEvent>();
  private readonly budget: BudgetOptions;
  private readonly projectDir: string;
  private readonly sessionId = `fake-${randomUUID()}`;
  private recorded: RecordedInjection | null = null;

  constructor(opts: FakeInjectorOptions) {
    this.projectDir = opts.projectDir;
    this.budget = opts.budget;
    this.store = new CardStore(opts.projectDir);
  }

  session(): SessionInfo {
    return { id: this.sessionId, projectDir: this.projectDir, resumed: false };
  }

  async send(text: string): Promise<SendResult> {
    const messageId = randomUUID();
    const { payload, slugs } = await computeInjection(
      text,
      this.store,
      this.log,
      this.budget
    );

    // Record what would have reached the agent (the boundary the real hook
    // also feeds). Only a non-empty injection is recorded as "last injection".
    this.recorded = { messageId, payload, slugs };

    if (slugs.length > 0) {
      this.bus.publish({ type: "injection", messageId, slugs });
    }

    // Scripted response: echo that the agent "received" the message. The reply
    // deliberately references injection presence so e2e can see a response.
    const reply =
      slugs.length > 0
        ? `Fake agent: received your message with context for ${slugs.join(", ")}.`
        : `Fake agent: received your message.`;
    this.bus.publish({ type: "assistant_delta", messageId, text: reply });
    this.bus.publish({ type: "assistant_done", messageId });

    return { messageId, slugs };
  }

  events(): AsyncIterable<AgentEvent> {
    return this.bus.subscribe();
  }

  lastInjection(): RecordedInjection | null {
    return this.recorded;
  }

  close(): Promise<void> {
    this.bus.close();
    return Promise.resolve();
  }
}
