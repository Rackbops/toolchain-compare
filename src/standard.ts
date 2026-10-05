import type { MatchKind, PackageManager, Standard, StandardHost, StandardTool } from "./compare.js";

const KNOWN_MATCHES: readonly MatchKind[] = ["exact", "minor", "major", "fleet-max"];
const KNOWN_MANAGERS: readonly PackageManager[] = [
  "apt",
  "winget",
  "scoop",
  "choco",
  "snap",
  "pip",
];

/** Thrown by {@link parseStandard} naming the exact field that failed a shape check. */
export class StandardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StandardParseError";
  }
}

/**
 * Parse a raw JSON value -- the body of `GET /api/toolchain/standard` -- into the `Standard`
 * shape `compare.ts` consumes (Epic #667, E2/C2). The exact checks `scripts/build-standard.ts`
 * used to make at build time against the committed, trusted `toolchain-standard.json`, moved
 * here unchanged and run instead against an untrusted network response every page load: schema
 * version, `roles`/`unmanaged` as string arrays, `hosts` objects with string-array `roles`,
 * each tool's `applies`/`match`/`target` presence rules, `packages` manager/id shape (#676).
 * `_comment` is dropped simply by never being copied into the returned object. Still NOT a port
 * of `toolchain_standard.py`'s full `validate()` (role references, target precision per match
 * kind stay the PR-time Python check) -- this exists so a malformed standard renders one
 * "Standard unavailable" page state instead of a fleet matrix full of nonsense.
 *
 * The one check with no build-time equivalent: the root value itself might not be an object at
 * all (a network response can be anything -- an upstream 200 with an empty body parses to
 * `undefined`, a proxy could return an array or a bare string). The committed file never needed
 * this guard; an untrusted fetch does.
 */
export function parseStandard(raw: unknown): Standard {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StandardParseError("standard: expected an object");
  }
  const data = raw as Record<string, unknown>;

  if (data.schemaVersion !== 1) {
    throw new StandardParseError(
      `schemaVersion: expected 1, got ${JSON.stringify(data.schemaVersion)}`,
    );
  }
  if (!Array.isArray(data.roles) || !data.roles.every((r) => typeof r === "string")) {
    throw new StandardParseError("`roles` must be an array of strings");
  }
  if (typeof data.hosts !== "object" || data.hosts === null || Array.isArray(data.hosts)) {
    throw new StandardParseError("`hosts` must be an object");
  }
  if (typeof data.tools !== "object" || data.tools === null || Array.isArray(data.tools)) {
    throw new StandardParseError("`tools` must be an object");
  }
  if (!Array.isArray(data.unmanaged) || !data.unmanaged.every((u) => typeof u === "string")) {
    throw new StandardParseError("`unmanaged` must be an array of strings");
  }

  const hosts: Record<string, StandardHost> = {};
  for (const [name, hraw] of Object.entries(data.hosts as Record<string, unknown>)) {
    const h = hraw as { roles?: unknown };
    if (!Array.isArray(h.roles) || !h.roles.every((r) => typeof r === "string")) {
      throw new StandardParseError(`hosts.${name}.roles must be an array of strings`);
    }
    hosts[name] = { roles: h.roles as string[] };
  }

  const tools: Record<string, StandardTool> = {};
  for (const [name, traw] of Object.entries(data.tools as Record<string, unknown>)) {
    const t = traw as { applies?: unknown; match?: unknown; target?: unknown; packages?: unknown };
    if (!Array.isArray(t.applies) || !t.applies.every((a) => typeof a === "string")) {
      throw new StandardParseError(`tools.${name}.applies must be an array of strings`);
    }
    if (typeof t.match !== "string" || !KNOWN_MATCHES.includes(t.match as MatchKind)) {
      throw new StandardParseError(`tools.${name}.match: unknown match ${JSON.stringify(t.match)}`);
    }
    if (t.target !== undefined && typeof t.target !== "string") {
      throw new StandardParseError(`tools.${name}.target must be a string`);
    }
    // Presence/absence (not precision -- that stays the PR-time toolchain_standard.py check) --
    // a `target` left off an `exact`/`minor`/`major` tool would otherwise silently become
    // `undefined` and read as "nobody in the fleet has ever installed this" for every host,
    // forever.
    if (t.match === "fleet-max" && t.target !== undefined) {
      throw new StandardParseError(`tools.${name}: match 'fleet-max' must not carry a target`);
    }
    if (t.match !== "fleet-max" && t.target === undefined) {
      throw new StandardParseError(
        `tools.${name}: match ${JSON.stringify(t.match)} needs a target`,
      );
    }
    let packages: Partial<Record<PackageManager, string>> | undefined;
    if (t.packages !== undefined) {
      if (typeof t.packages !== "object" || t.packages === null || Array.isArray(t.packages)) {
        throw new StandardParseError(`tools.${name}.packages must be an object`);
      }
      packages = {};
      for (const [manager, id] of Object.entries(t.packages as Record<string, unknown>)) {
        if (!KNOWN_MANAGERS.includes(manager as PackageManager)) {
          throw new StandardParseError(
            `tools.${name}.packages: unknown manager ${JSON.stringify(manager)}`,
          );
        }
        if (typeof id !== "string" || id === "") {
          throw new StandardParseError(
            `tools.${name}.packages.${manager} must be a non-empty string`,
          );
        }
        packages[manager as PackageManager] = id;
      }
    }
    tools[name] = {
      applies: t.applies as string[],
      match: t.match as MatchKind,
      target: t.target as string | undefined,
      ...(packages !== undefined ? { packages } : {}),
    };
  }

  return {
    schemaVersion: data.schemaVersion,
    roles: data.roles as string[],
    hosts,
    tools,
    unmanaged: data.unmanaged as string[],
  };
}
