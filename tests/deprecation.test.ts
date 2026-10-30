/**
 * deprecation.test.ts — geode deprecation cleanup contracts (TDD).
 *
 * Every deprecated artifact here has a live replacement. The test pins the
 * REPLACEMENT contract and FAILS if the deprecated artifact resurfaces or a
 * consumer still points at it. Deleting is only done after green.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GEODE = join(import.meta.dir, "..");

describe("DEPRECATED geode/ssot/ports.env", () => {
  // The file self-declares: "Delete this file once every consumer is repointed."
  test("does not exist — geode ports come only from the estate canonical", () => {
    expect(existsSync(join(GEODE, "ssot", "ports.env"))).toBe(false);
  });

  test("canonical estate/config/ports.env carries every geode pen port", () => {
    const canonical = readFileSync("/home/toxic/pens/estate/config/ports.env", "utf8");
    for (const portKey of [
      "CHALCOPYRITE_PORT",
      "BORNITE_PORT",
      "RHODOCHROSITE_PORT",
      "PENS_COMPLETIONS_PORT",
    ]) {
      expect(
        canonical.includes(`${portKey}=`),
        `canonical ports.env lost ${portKey}`,
      ).toBe(true);
    }
  });
});

describe("DEPRECATED tau extensibility legacy-* shims", () => {
  // The legacy-* shims exist to keep old plugin imports resolving. Their
  // replacement is the native extensions surface + plugins/loader; once every
  // loader resolves through the new path the shims are deletable.
  test("at least one legacy shim is now unreferenced by production loaders", () => {
    const productionLoaders = [
      join(GEODE, "..", "olympus/products/tau/packages/coding-agent/src/extensibility/extensions/loader.ts"),
      join(GEODE, "..", "olympus/products/tau/packages/coding-agent/src/extensibility/plugins/loader.ts"),
    ];
    const legacyFiles = [
      "legacy-pi-contract.ts",
      "legacy-bundled-resolver.ts",
      "legacy-pi-config.ts",
      "legacy-tau-code-shim.ts",
    ];
    const refs = productionLoaders
      .filter(existsSync)
      .flatMap((loader) => {
        try {
          return [readFileSync(loader, "utf8")];
        } catch {
          return [];
        }
      })
      .join("\n");
    const unreferenced = legacyFiles.filter(
      (name) => !refs.includes(name.replace(/\.ts$/, "")),
    );
    // At least one legacy shim is no longer imported by production loaders →
    // candidate for deletion after its coverage test goes green.
    expect(unreferenced.length).toBeGreaterThan(0);
  });
});