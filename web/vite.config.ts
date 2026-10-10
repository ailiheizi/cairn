import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { admitPresentationPackage, readPresentationPackageIndex } from "./src/lib/presentationPackages";
import type { PresentationRefusalCode } from "./src/lib/presentationPackages";
import { BUILT_IN_THEME_IDS } from "./src/lib/appearance";

// The application version reaches presentation-package admission at build time
// (ADR-032, Stage 2a). Injecting it here keeps the client from reading
// package.json at runtime and from holding a second version source.
const applicationVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version as string;

const webRoot = fileURLToPath(new URL(".", import.meta.url));
/**
 * The source of truth for presentation packages. Vite already carries this
 * public directory into the served output on every build, so the packages ship
 * with `npm run build` and a rebuild can no longer destroy them. Nothing new
 * reads them here: the client still fetches `<web root>/presentation-packages/`
 * at runtime.
 */
const sourcePackageRoot = resolve(webRoot, "public", "presentation-packages");
const PACKAGE_FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.json$/i;

/** One stable sentence per refusal code, so a build failure names the reason. */
const REFUSAL_REASONS: Record<PresentationRefusalCode, string> = {
  "index-schema": "the package index is not a valid `cairn.presentation-package-index.v1` document",
  "index-entry": "the index lists an entry that is not a plain `*.json` file name",
  schema: "the declared schema is not `cairn.presentation-package.v1`",
  manifest: "the manifest is invalid",
  id: "the package id is invalid",
  collision: "the package id is already in use",
  "host-range": "this application version is outside the declared host range",
  "host-range-syntax": "the declared host range is not a supported comparator list",
  "token-key": "a declared key is not an admitted design token",
  "token-value": "a token value could escape a CSS declaration",
  read: "the listed package file could not be read",
};

function reasonFor(code: PresentationRefusalCode, detail: string): string {
  return `${REFUSAL_REASONS[code]} (${code}: ${detail})`;
}

/**
 * One build-time admission pass over the source package directory. It reuses
 * the runtime admission function, so the build and the client can never
 * disagree about what an admissible package is; the only difference is that a
 * refusal here stops the build instead of being reported in the interface.
 *
 * An absent or empty directory is normal and admits nothing. Returns one
 * message per offending package; an empty array means the directory is fully
 * admissible.
 */
export function validateSourcePresentationPackages(packageRoot: string, appVersion: string): string[] {
  if (!existsSync(packageRoot)) return [];
  const indexFile = join(packageRoot, "index.json");
  const problems: string[] = [];
  if (!existsSync(indexFile)) {
    const strays = readdirSync(packageRoot).filter((name) => PACKAGE_FILE_PATTERN.test(name));
    for (const stray of strays) {
      problems.push(`presentation-packages/${stray}: a package file exists but there is no index.json listing it`);
    }
    return problems;
  }

  let indexValue: unknown;
  try {
    indexValue = JSON.parse(readFileSync(indexFile, "utf8")) as unknown;
  } catch (error) {
    return [`presentation-packages/index.json: not a JSON document (${error instanceof Error ? error.message : String(error)})`];
  }
  const index = readPresentationPackageIndex(indexValue, "presentation-packages/index.json");
  for (const refusal of index.refusals) {
    problems.push(`presentation-packages/index.json: ${reasonFor(refusal.code, refusal.detail)}`);
  }
  if (problems.length > 0) return problems;

  const admittedIds: string[] = [];
  const listed = new Set<string>();
  for (const file of index.files as readonly string[]) {
    const path = join(packageRoot, file);
    if (listed.has(file)) {
      problems.push(`presentation-packages/index.json: ${file} is listed more than once`);
      continue;
    }
    listed.add(file);
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch (error) {
      problems.push(`presentation-packages/${file}: not a JSON document (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const result = admitPresentationPackage(document, { appVersion, builtInThemeIds: BUILT_IN_THEME_IDS, admittedIds });
    if (result.admitted) {
      admittedIds.push(result.package.id);
    } else {
      problems.push(`presentation-packages/${file}: ${reasonFor(result.refusal.code, result.refusal.detail)}`);
    }
  }

  // A package file nobody listed would ship in the output but never be read.
  // That is exactly the "dropped into the build output" habit this stage
  // replaces, so the build names it instead of shipping it silently.
  for (const name of readdirSync(packageRoot)) {
    if (!PACKAGE_FILE_PATTERN.test(name)) continue;
    if (name === "index.json") continue;
    if (!listed.has(name)) {
      problems.push(`presentation-packages/${name}: a package file exists but index.json does not list it, so it would ship unread`);
    }
  }
  return problems;
}

/**
 * Refuse rather than ship. The check runs as soon as the resolved config is
 * known and before Vite copies the public directory into the output, so a
 * refused package fails `npm run build` loudly and leaves the previous output
 * untouched. The runtime admission path is unchanged: a file dropped straight
 * into the served root is still admitted or refused in the interface exactly as
 * it is today.
 */
function presentationPackageGuard(): Plugin {
  return {
    name: "cairn:presentation-package-admission",
    configResolved() {
      const problems = validateSourcePresentationPackages(sourcePackageRoot, applicationVersion);
      if (problems.length === 0) return;
      throw new Error(
        `presentation package admission failed for web/public/presentation-packages/ `
        + `(application version ${applicationVersion}):\n`
        + problems.map((problem) => `  - ${problem}`).join("\n"),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), presentationPackageGuard()],
  define: {
    __CAIRN_APP_VERSION__: JSON.stringify(applicationVersion),
  },
  server: {
    port: 5173,
    // The browser client speaks only the daemon's typed loopback API. Keep
    // the development server convenient without adding a second backend.
    proxy: {
      "/api": {
        target: process.env.CAIRN_API_TARGET ?? "http://127.0.0.1:4534",
        changeOrigin: true,
      },
    },
  },
});
