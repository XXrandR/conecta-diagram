import { assembleTab } from "./assemble.js";
import { traceTab } from "./trace.js";
import { performanceTab } from "./performance.js";
export function registerDefaultTabs(shell) {
  for (const tab of [assembleTab, traceTab, performanceTab])
    shell.registerTab(tab);
}
