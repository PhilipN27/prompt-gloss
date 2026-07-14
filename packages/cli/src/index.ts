// prompt-gloss — programmatic entry points (the bin lives in cli.ts).
export { runInit, type InitOptions } from "./commands/init.js";
export { runUninstall, type UninstallOptions } from "./commands/uninstall.js";
export { runAdd, type AddOptions } from "./commands/add.js";
export { runLog, type LogOptions } from "./commands/log.js";
export { runDoctor, type DoctorOptions, type DoctorResult } from "./commands/doctor.js";
export { runWeb, type WebOptions } from "./commands/web.js";
export {
  mergeGlossEntries,
  removeGlossEntries,
  GLOSS_HOOK_MARKER,
  USER_PROMPT_SUBMIT_COMMAND,
  SESSION_START_COMMAND
} from "./settings.js";
