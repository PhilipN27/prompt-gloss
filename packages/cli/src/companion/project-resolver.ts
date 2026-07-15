// Resolves which project a captured card belongs to (TERMINAL.md §8.2). The
// companion targets ONE project: an explicit `--project` resolves immediately;
// otherwise the flow opens the project-picker page (the picker page + persisting
// the choice is the panel slice's job). Crucially it does NOT fall back to
// `process.cwd()` — the companion must never silently write cards under whatever
// directory launched the daemon (council-pinned, 2026-07-14).

import type { ProjectResolution, ProjectResolver } from "./types.js";

export interface ProjectResolverOptions {
  /** The `--project <dir>` value, already resolved to an absolute path, or
   *  undefined when none was given. */
  readonly explicitProjectDir?: string;
}

export function createProjectResolver(opts: ProjectResolverOptions): ProjectResolver {
  return {
    resolve: async (): Promise<ProjectResolution> =>
      opts.explicitProjectDir
        ? { kind: "project", dir: opts.explicitProjectDir }
        : { kind: "picker" }
  };
}
