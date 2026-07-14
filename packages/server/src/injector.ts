// The Injector boundary (ARCHITECTURE.md §7/§9). An Injector owns one agent
// session for one project dir: it accepts user messages, delivers the matched
// <gloss-context> payload to the agent, and emits a stream of events (assistant
// deltas, tool events, the injection indicator, errors) that the server relays
// to the browser over SSE.
//
// Two implementations share this exact boundary:
//   - SdkInjector  — the real @anthropic-ai/claude-agent-sdk session; injection
//     is delivered via the UserPromptSubmit hook's additionalContext.
//   - FakeInjector — GLOSS_FAKE_AGENT=1; a scripted responder that records the
//     injected payload (exposed at GET /api/debug/last-injection).
//
// Keeping the boundary free of SDK types means integration/e2e tests verify the
// pipeline up to here in both modes; only the real SDK hook wiring (which never
// fires in fake mode) needs a separate live smoke check.

export interface SessionInfo {
  /** SDK session id, or null before the first message establishes one. */
  id: string | null;
  projectDir: string;
  /** True when this session resumed a persisted id from a prior process. */
  resumed: boolean;
}

/** An event emitted by the agent session, relayed to the browser over SSE. */
export type AgentEvent =
  | { type: "assistant_delta"; messageId: string; text: string }
  | { type: "assistant_done"; messageId: string }
  | { type: "tool"; messageId: string; name: string; detail?: string }
  | { type: "injection"; messageId: string; slugs: string[] }
  | { type: "system"; subtype: string; sessionId?: string }
  | { type: "error"; message: string };

/** The payload recorded for the debug endpoint (fake mode). */
export interface RecordedInjection {
  messageId: string;
  payload: string;
  slugs: string[];
}

/** Result of accepting a user message. */
export interface SendResult {
  messageId: string;
  /** Slugs injected on this message (also emitted as an `injection` event). */
  slugs: string[];
}

export interface Injector {
  /** Current session info (id may be null until the first message). */
  session(): SessionInfo;

  /** Enqueue a user message; computes + delivers injection; returns its id + slugs. */
  send(text: string): Promise<SendResult>;

  /** Async iterable of agent events for the SSE stream. */
  events(): AsyncIterable<AgentEvent>;

  /** The last injection payload (fake mode only; null otherwise or if none yet). */
  lastInjection(): RecordedInjection | null;

  /** Shut the session down and stop the event stream. */
  close(): Promise<void>;
}
