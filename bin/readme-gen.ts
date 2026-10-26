#!/usr/bin/env bun
// readme-gen.ts — thin entrypoint that delegates to the shared generator.
// Usage: bun ./bin/readme-gen.ts  (reads pen dir from cwd)
import { generate } from "../../barn/estate-ops/scaffold/bin/readme-gen.ts";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const penDir = dirname(dirname(fileURLToPath(import.meta.url)));
const out = generate({ penDir });
console.log(`Generated ${out}`);
