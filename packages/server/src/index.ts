// @prompt-gloss/server — Fastify server, Agent SDK session, injection pipeline.
export { buildServer, type CardSavedEvent, type ServerHooks } from "./app.js";
// Re-exported so workspace consumers (the CLI) can type a server instance
// without taking a direct `fastify` dependency under pnpm's strict layout.
export type { FastifyInstance } from "fastify";
export { resolveConfig, type GlossServerConfig } from "./config.js";
export type {
  AgentEvent,
  Injector,
  RecordedInjection,
  SendResult,
  SessionInfo
} from "./injector.js";
