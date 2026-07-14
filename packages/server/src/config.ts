// Server configuration, resolved from env + explicit overrides. Kept tiny and
// pure so tests can construct a config for a temp project dir directly.

import type { BudgetOptions } from "@prompt-gloss/core";

export interface GlossServerConfig {
  /** The user's project directory; `.gloss/` lives under it. */
  projectDir: string;
  /** Bind host — always localhost (ARCHITECTURE.md §7: 127.0.0.1 only). */
  host: string;
  port: number;
  /** When true, the SDK call is replaced by a scripted responder (TESTING.md). */
  fakeAgent: boolean;
  /** Injection budget knobs (env-overridable). */
  budget: BudgetOptions;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build a config from environment variables plus required overrides. The
 * project dir must be provided explicitly (tests pass a temp dir; the CLI
 * passes cwd or GLOSS_PROJECT_DIR).
 */
export function resolveConfig(
  overrides: Partial<GlossServerConfig> = {}
): GlossServerConfig {
  const projectDir =
    overrides.projectDir ?? process.env.GLOSS_PROJECT_DIR ?? process.cwd();
  return {
    projectDir,
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? intFromEnv("GLOSS_PORT", 4319),
    fakeAgent: overrides.fakeAgent ?? process.env.GLOSS_FAKE_AGENT === "1",
    budget: overrides.budget ?? {
      budget: intFromEnv("GLOSS_INJECT_BUDGET", 2000),
      cardCap: intFromEnv("GLOSS_CARD_CAP", 800)
    }
  };
}
