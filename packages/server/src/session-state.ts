// Machine-local SDK session state (ARCHITECTURE.md §4). Persists the session id
// to `.gloss/.state/session.json` for resume across restarts, and writes
// `.gloss/.state/.gitignore` containing `*` so committing `.gloss/` never
// commits machine state (the Terraform trick).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PersistedSession {
  sessionId: string;
  updatedAt: string;
}

export class SessionState {
  private readonly stateDir: string;
  private readonly sessionFile: string;

  constructor(projectDir: string) {
    this.stateDir = join(projectDir, ".gloss", ".state");
    this.sessionFile = join(this.stateDir, "session.json");
  }

  /** Ensure `.state/` exists and self-gitignores. */
  private async ensureDir(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    // Idempotent: always (re)write the self-ignoring .gitignore.
    await writeFile(join(this.stateDir, ".gitignore"), "*\n", "utf8");
  }

  /** Read a persisted session id, or null if none/unreadable. */
  async read(): Promise<string | null> {
    try {
      const text = await readFile(this.sessionFile, "utf8");
      const parsed = JSON.parse(text) as PersistedSession;
      return typeof parsed.sessionId === "string" ? parsed.sessionId : null;
    } catch {
      return null;
    }
  }

  /** Persist a session id (and the self-ignoring .gitignore). */
  async write(sessionId: string): Promise<void> {
    await this.ensureDir();
    const data: PersistedSession = { sessionId, updatedAt: new Date().toISOString() };
    await writeFile(this.sessionFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}
