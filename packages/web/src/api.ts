// Typed client for the Gloss server API (ARCHITECTURE.md §7). Every request
// goes through here so the rest of the UI never touches fetch/SSE directly.

import type { Card } from "@prompt-gloss/core";
import type { AgentEvent, SessionInfo } from "@prompt-gloss/server";

export type { AgentEvent, SessionInfo };
export type { Card };

export interface CardSourceInput {
  span: string;
  message: string;
}

export interface CreateCardInput {
  term: string;
  aliases?: string[];
  body: string;
  source: CardSourceInput;
}

export interface UpdateCardInput {
  term?: string;
  aliases?: string[];
  body?: string;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gloss API ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function getSession(): Promise<SessionInfo> {
  return fetch("/api/session").then((r) => asJson<SessionInfo>(r));
}

export function listCards(): Promise<Card[]> {
  return fetch("/api/cards").then((r) => asJson<Card[]>(r));
}

export function getCard(slug: string): Promise<Card | null> {
  return fetch(`/api/cards/${encodeURIComponent(slug)}`).then((r) => {
    if (r.status === 404) return null;
    return asJson<Card>(r);
  });
}

export function createCard(input: CreateCardInput): Promise<Card> {
  return fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then((r) => asJson<Card>(r));
}

export function updateCard(slug: string, input: UpdateCardInput): Promise<Card> {
  return fetch(`/api/cards/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then((r) => asJson<Card>(r));
}

export async function deleteCard(slug: string): Promise<void> {
  const res = await fetch(`/api/cards/${encodeURIComponent(slug)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Gloss API ${res.status}: failed to delete card`);
  }
}

export function matchText(text: string): Promise<{ slugs: string[] }> {
  return fetch("/api/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  }).then((r) => asJson<{ slugs: string[] }>(r));
}

export function sendMessage(text: string): Promise<{ messageId: string; slugs: string[] }> {
  return fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  }).then((r) => asJson<{ messageId: string; slugs: string[] }>(r));
}

/**
 * Subscribe to the server's SSE event stream. Returns an unsubscribe function.
 * Uses raw EventSource parsing (not the named-event API) so every event type
 * (assistant_delta, assistant_done, tool, injection, system, error) flows
 * through one handler, matching the `event: <type>\ndata: <json>` frames the
 * server writes (packages/server/src/app.ts).
 */
export function subscribeEvents(onEvent: (event: AgentEvent) => void): () => void {
  const source = new EventSource("/api/events");
  const types: AgentEvent["type"][] = [
    "assistant_delta",
    "assistant_done",
    "tool",
    "injection",
    "system",
    "error"
  ];
  const listeners = types.map((type) => {
    const listener = (ev: MessageEvent<string>): void => {
      try {
        onEvent(JSON.parse(ev.data) as AgentEvent);
      } catch {
        // Malformed frame: ignore rather than crash the UI.
      }
    };
    source.addEventListener(type, listener as EventListener);
    return { type, listener };
  });

  return () => {
    for (const { type, listener } of listeners) {
      source.removeEventListener(type, listener as EventListener);
    }
    source.close();
  };
}
