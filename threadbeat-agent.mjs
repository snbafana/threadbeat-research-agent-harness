#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("./threadbeat-agent.ts", import.meta.url));
const result = spawnSync(process.execPath, ["--import", "tsx", entrypoint, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
