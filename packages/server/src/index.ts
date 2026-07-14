// @prompt-gloss/server — Fastify server, Agent SDK session, injection pipeline.
export { buildServer } from "./app.js";
export { resolveConfig, type GlossServerConfig } from "./config.js";
export type {
  AgentEvent,
  Injector,
  RecordedInjection,
  SendResult,
  SessionInfo
} from "./injector.js";
