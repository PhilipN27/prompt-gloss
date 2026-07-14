import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({ color: true, ui: "tdd" });
  const testsRoot = fileURLToPath(new URL(".", import.meta.url));
  const files = await glob("**/*.test.js", { cwd: testsRoot });

  for (const file of files) mocha.addFile(resolve(testsRoot, file));

  await new Promise<void>((resolveRun, rejectRun) => {
    mocha.run((failures) => {
      if (failures === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${failures} VS Code extension test(s) failed.`));
    });
  });
}
