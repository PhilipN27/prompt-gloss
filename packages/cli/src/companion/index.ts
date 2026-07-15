// @prompt-gloss companion module (TERMINAL.md §8). Barrel for the CLI entry and
// the parallel adapter/panel slices — the foundation contracts everything else
// builds on.

export { runCompanion, type CompanionOptions, type CompanionHandle } from "./command.js";
export { CaptureFlow, type CaptureFlowDeps } from "./flow.js";
export {
  selectAdapter,
  currentEnv,
  type CaptureAdapter,
  type AdapterEnv
} from "./select.js";
export {
  startPanelServer,
  type PanelServer,
  type PanelServerOptions
} from "./server-embed.js";
export {
  assessFreshness,
  armFreshness,
  FRESHNESS_WINDOW_MS,
  type FreshnessState,
  type FreshnessSnapshot,
  type FreshnessDecision
} from "./freshness.js";
export { readProjectRegistry } from "./project-registry.js";
export { createProjectResolver, type ProjectResolverOptions } from "./project-resolver.js";
export { createAppModeOpener } from "./opener.js";
export { createOsNotifier } from "./notifier.js";
export { installAutostart, type AutostartOptions } from "./autostart.js";
export * from "./types.js";
