import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "@prompt-gloss/server";
import { buildServer } from "@prompt-gloss/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerCompanionPanelRoutes,
  type CompanionPanelRouteOptions
} from "../../src/companion/picker.js";

const cleanup: string[] = [];
let app: FastifyInstance | undefined;

function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

function writeRegistry(homeDir: string, projects: readonly string[]): void {
  mkdirSync(join(homeDir, ".gloss"), { recursive: true });
  writeFileSync(
    join(homeDir, ".gloss", "projects.json"),
    JSON.stringify({ version: 1, projects }),
    "utf8"
  );
}

type ProjectSelector = NonNullable<CompanionPanelRouteOptions["onProjectSelected"]>;

async function createApp(
  homeDir: string,
  onProjectSelected?: ProjectSelector
): Promise<FastifyInstance> {
  app = await buildServer({ projectDir: temporaryDirectory("gloss-picker-project-"), fakeAgent: true });
  registerCompanionPanelRoutes(app, {
    homeDir,
    ...(onProjectSelected ? { onProjectSelected } : {})
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("companion project picker page", () => {
  it("lists registry projects and HTML-escapes their paths", async () => {
    const home = temporaryDirectory("gloss-picker-home-");
    writeRegistry(home, ["C:\\work\\alpha", "/tmp/<script>"]);
    const server = await createApp(home);

    const response = await server.inject({ method: "GET", url: "/panel?pick=1&span=billing" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("C:\\work\\alpha");
    expect(response.body).toContain("/tmp/&lt;script&gt;");
    expect(response.body).not.toContain("/tmp/<script>");
  });

  it("explains how to initialize a project when the registry is empty", async () => {
    const server = await createApp(temporaryDirectory("gloss-picker-home-"));

    const response = await server.inject({ method: "GET", url: "/panel?pick=1" });

    expect(response.body).toContain("No initialized projects yet");
    expect(response.body).toContain("prompt-gloss init");
  });

  it("serves the minimal card form with a prefilled, escaped span and real API POST", async () => {
    const server = await createApp(temporaryDirectory("gloss-picker-home-"));

    const response = await server.inject({
      method: "GET",
      url: "/panel?span=billing%20%26%20%3Cengine%3E&origin=companion"
    });

    expect(response.body).toContain('value="billing &amp; &lt;engine&gt;"');
    expect(response.body).toContain('fetch("/api/cards"');
    expect(response.body).toContain('origin: "companion"');
  });

  it("passes an allow-listed selection to the rebind callback and returns its panel URL", async () => {
    const home = temporaryDirectory("gloss-picker-home-");
    writeRegistry(home, ["/projects/alpha"]);
    const onProjectSelected = vi.fn(async () => ({
      panelUrl: "http://127.0.0.1:54321/panel?span=billing&origin=companion"
    }));
    const server = await createApp(home, onProjectSelected);

    const response = await server.inject({
      method: "POST",
      url: "/api/companion/project",
      payload: { projectDir: "/projects/alpha", span: "billing", origin: "other" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      panelUrl: "http://127.0.0.1:54321/panel?span=billing&origin=companion"
    });
    expect(onProjectSelected).toHaveBeenCalledWith({
      projectDir: "/projects/alpha",
      span: "billing",
      origin: "companion"
    });
  });

  it("rejects a project that is not in the registry", async () => {
    const home = temporaryDirectory("gloss-picker-home-");
    writeRegistry(home, ["/projects/alpha"]);
    const server = await createApp(home, vi.fn(async () => ({ panelUrl: "" })));

    const response = await server.inject({
      method: "POST",
      url: "/api/companion/project",
      payload: { projectDir: "/projects/other", span: "billing" }
    });

    expect(response.statusCode).toBe(400);
  });

  it("reports the explicit integration gap when no rebind callback is wired", async () => {
    const home = temporaryDirectory("gloss-picker-home-");
    writeRegistry(home, ["/projects/alpha"]);
    const server = await createApp(home);

    const response = await server.inject({
      method: "POST",
      url: "/api/companion/project",
      payload: { projectDir: "/projects/alpha", span: "billing" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain("not wired");
  });
});
