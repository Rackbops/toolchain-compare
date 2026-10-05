/**
 * Pure comparator for the fleet toolchain matrix, shared by consumers (tools-site,
 * artifact-console) (Rackbops/Tooling#634, TC-6).
 *
 * Compares the fleet toolchain standard (`toolchain-standard.json`, fetched at runtime via
 * `GET /api/toolchain/standard` and parsed by `standard.ts`'s `parseStandard`, Epic #667 E2/C2)
 * against the fleet's live inventory sidecars (fetched at runtime via
 * `GET /api/toolchain/sidecar/<host>`, schema owned by `artifact-console`'s
 * `toolchain_sidecar.py`) and produces a per-tool/per-host matrix plus a flat action list.
 *
 * Version-matching semantics (`matchVersion` / `compareVersion`) are a deliberate TypeScript
 * port of `toolchain_standard.py`'s `matches()` / `compare_version()` -- the Python module is
 * the reference; `compare.test.ts` shares its fixture table so the two can't silently drift
 * apart.
 */

/** A tool's target precision, or `fleet-max` (no fixed target -- decided by the fleet's own
 * highest reported version, computed here since `toolchain_standard.py` never reads a real
 * inventory). */
export type MatchKind = "exact" | "minor" | "major" | "fleet-max";

/** One cell's status. `matches()`'s Python reference only ever returns `ok`/`behind` -- this
 * comparator adds the two states that need a live inventory to decide: `missing` (the tool
 * applies to this host but isn't reported) and `n/a` (the tool doesn't apply to this host's
 * roles at all, so there's nothing to check). */
export type CellStatus = "ok" | "behind" | "missing" | "n/a";

export interface StandardHost {
  roles: string[];
}

/** The package-manager ids a tool's `packages` map may key on (#676) -- fixed and closed,
 * mirroring `toolchain_standard.py`'s `_KNOWN_MANAGERS`; an unrecognized key fails loudly in
 * `standard.ts`'s `parseStandard` rather than being silently dropped. */
export type PackageManager = "apt" | "winget" | "scoop" | "choco" | "snap" | "pip";

export interface StandardTool {
  applies: string[];
  match: MatchKind;
  target?: string;
  /** The real package name/id each manager accepts (`{"apt": "git", "winget": "Git.Git"}`),
   * verified against the manager itself when the standard was authored -- never guessed. Absent
   * (or missing an entry for a given manager) means no verified id exists yet; `issue.ts`'s
   * `fixHint` falls back to a clearly-marked guess rather than a wrong real-looking command. */
  packages?: Partial<Record<PackageManager, string>>;
}

/** The parsed `toolchain-standard.json` shape, minus its `_comment` key (dropped by
 * `standard.ts`'s `parseStandard`; never consumed at runtime). */
export interface Standard {
  schemaVersion: number;
  roles: string[];
  hosts: Record<string, StandardHost>;
  tools: Record<string, StandardTool>;
  unmanaged: string[];
}

export interface SidecarTool {
  name: string;
  category: string;
  version: string;
  path: string;
  source: string;
}

export interface SidecarUncatalogued {
  name: string;
  path: string;
}

export interface SidecarSide {
  /** `"windows"` | `"wsl:<distro>"` | `"linux"`. */
  side: string;
  tools: SidecarTool[];
  uncatalogued: SidecarUncatalogued[];
}

/** The `toolchain-inventory-<host>.json` shape owned by artifact-console's
 * `toolchain_sidecar.py` -- ported here rather than imported, since the two repos don't share
 * a TypeScript dependency. */
export interface Sidecar {
  schemaVersion: number;
  host: string;
  hostname: string;
  os: "windows" | "linux";
  generated: string;
  sides: SidecarSide[];
}

/** One applicable role's own status, alongside the headline `Cell`/`Action` that folds every
 * applicable role into a single worst-wins result -- lets a consumer show which role produced
 * that result instead of only the fold (Rackbops/Tooling#666). */
export interface RoleStatus {
  role: string;
  /** The matched sidecar side name (`"windows"`, `"wsl:Ubuntu"`, `"linux"`) when this role's
   * side reported the tool; falls back to `role` itself when the side is absent or doesn't
   * report the tool (there's no side name to show, and `status` is `"missing"` in that case). */
  side: string;
  status: "ok" | "behind" | "missing";
  version?: string;
  source?: string;
}

export interface Cell {
  status: CellStatus;
  /** The version this status was decided from. Absent for `missing` (nothing was found) and
   * `n/a` (nothing to compare). */
  version?: string;
  /** The resolved target: `tool.target` for `exact`/`minor`/`major`, or the computed fleet
   * maximum for `fleet-max`. Absent only when `fleet-max` has no reported version anywhere in
   * the fleet to compute a maximum from. */
  target?: string;
  /** One entry per applicable role, in `tool.applies` order -- present whenever this host has
   * at least one applicable role (absent only for `n/a`, where there is nothing to enumerate).
   * Lets a consumer show a multi-role host's per-role detail instead of only the worst-wins
   * headline above (#666). */
  roles?: RoleStatus[];
}

export interface Row {
  tool: string;
  match: MatchKind;
  /** Keyed by host name (`standard.hosts` key, e.g. `"nitro"`). */
  cells: Record<string, Cell>;
}

/** One recommended action for a `behind`/`missing` cell. Carries structured fields (not just
 * `text`) so a consumer (TC-7's issue filer) never has to parse the display string. */
export interface Action {
  /** `<host>|<tool>|<status>` -- stable across runs as long as the cell's status doesn't
   * change, so a consumer can dedupe/track an action across two comparator runs. */
  id: string;
  host: string;
  tool: string;
  status: "behind" | "missing";
  /** The installed version that was found behind. Present for `behind`, absent for
   * `missing` (nothing was found to report a version for). */
  installed?: string;
  target?: string;
  match: MatchKind;
  /** The sidecar row's own `source` -- artifact-console's `Get-WinSource`/`Get-WslSource`
   * real values are `"cargo"`, `"pip/pipx"`, `"winget/store"`, `"apt/system"`,
   * `"scoop"`/`"choco"`/`"nvm"`/`"installer"`/`"user-install"`/`"snap"`, or `""` -- for the
   * SAME role/side that supplied `installed` (issue #671), so the filer's fix hint can follow
   * how the tool was actually installed instead of guessing from the host's OS alone. Absent
   * for `missing` (nothing was found to attribute a source to), matching `installed`'s own
   * absence there. */
  source?: string;
  /** The cell's own `roles` (#666) -- carried through so a consumer (the issue filer) can
   * qualify the title/body by role without a second lookup back into `Row.cells`. */
  roles?: RoleStatus[];
  text: string;
}

export interface CompareResult {
  matrix: Row[];
  actions: Action[];
  /** Host names (from `inventories`, not `standard.hosts`) whose `generated` timestamp is
   * more than 14 days old as of `now`. A host with no sidecar at all is never listed here --
   * that's "no data yet", a different condition from "data, but stale". */
  stale: string[];
}

const VERSION_RE = /^\d+(\.\d+){0,2}$/;

/** Parse a dotted version string into its numeric components, or `null` if it doesn't match
 * `VERSION_RE` -- the single place that decides "is this a version" (mirrors
 * `toolchain_standard.py`'s `_parse_version`). */
export function parseVersion(v: string): number[] | null {
  if (!VERSION_RE.test(v)) return null;
  return v.split(".").map(Number);
}

/** -1 / 0 / 1 comparing two dotted version strings, treating a missing trailing component as
 * 0 (so `3.14` == `3.14.0`). Throws naming whichever side didn't parse -- mirrors
 * `toolchain_standard.py`'s `compare_version`. */
export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null) throw new Error(`${a} is not a version`);
  if (pb === null) throw new Error(`${b} is not a version`);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const ca = pa[i] ?? 0;
    const cb = pb[i] ?? 0;
    if (ca < cb) return -1;
    if (ca > cb) return 1;
  }
  return 0;
}

/** `"ok"` or `"behind"` for how `installed` stacks up against `target` at `match` precision.
 * Mirrors `toolchain_standard.py`'s `matches()` exactly, minus the `fleet-max` case (not
 * decidable without the fleet's inventories -- computed separately in `compare()` below, then
 * compared here via `"exact"` against the resolved fleet-max target). Throws if either side
 * doesn't parse as a version. */
export function matchVersion(
  installed: string,
  match: Exclude<MatchKind, "fleet-max">,
  target: string,
): "ok" | "behind" {
  const pi = parseVersion(installed);
  const pt = parseVersion(target);
  if (pi === null) throw new Error(`${installed} is not a version`);
  if (pt === null) throw new Error(`${target} is not a version`);

  let ok: boolean;
  if (match === "exact") {
    ok = compareVersion(installed, target) === 0;
  } else if (match === "minor") {
    ok = pi[0] === pt[0] && pi[1] === pt[1];
  } else if (match === "major") {
    ok = pi[0] === pt[0];
  } else {
    throw new Error(`unknown match kind ${match as string}`);
  }
  return ok ? "ok" : "behind";
}

function sideMatchesRole(side: string, role: string): boolean {
  if (role === "windows-dev") return side === "windows";
  if (role === "wsl") return side.startsWith("wsl:");
  if (role === "linux-server") return side === "linux";
  return false;
}

/** Every version of `toolName` found in `sidecar`'s sides that correspond to a role both
 * `tool.applies` and the host's own `roles` share -- used only for the fleet-wide max (which
 * cares about every installed version found anywhere, not about any one host's coverage). */
function findVersions(
  standard: Standard,
  sidecar: Sidecar | undefined,
  hostName: string,
  toolName: string,
  tool: StandardTool,
): string[] {
  if (!sidecar) return [];
  const hostRoles = standard.hosts[hostName]?.roles ?? [];
  const applicableRoles = tool.applies.filter((r) => hostRoles.includes(r));
  const versions: string[] = [];
  for (const side of sidecar.sides) {
    if (!applicableRoles.some((r) => sideMatchesRole(side.side, r))) continue;
    const found = side.tools.find((t) => t.name === toolName);
    if (found) versions.push(found.version);
  }
  return versions;
}

/** `toolName`'s full sidecar row (version AND source) on the one side matching `role` in
 * `sidecar`, or `undefined` if that side is absent, or present but doesn't report the tool.
 * Per-role (not a flat list across all applicable sides) so `compare()` can tell "reported, but
 * behind" apart from "this applicable role never reported it at all" -- a host can carry more
 * than one applicable role (e.g. Melody is `windows-dev` + `wsl`, and a tool like `Node.js`
 * applies to both), and a required role with no report is worse than a sibling role merely
 * being out of date. Returns the whole `SidecarTool` (not just `.version`) so a caller can also
 * carry `.source` through to the recommended action (#671) without a second lookup. */
function findToolForRole(
  sidecar: Sidecar | undefined,
  role: string,
  toolName: string,
): SidecarTool | undefined {
  if (!sidecar) return undefined;
  for (const side of sidecar.sides) {
    if (!sideMatchesRole(side.side, role)) continue;
    const found = side.tools.find((t) => t.name === toolName);
    if (found) return found;
  }
  return undefined;
}

/** The sidecar side name that reports `toolName` on the one side matching `role`, or
 * `undefined` when no matching side reports it. Companion to `findToolForRole`, kept separate
 * rather than folded in: the caller only needs a side NAME when the role actually reported the
 * tool (#666's `RoleStatus.side`), so this stays a second, cheap lookup rather than changing
 * `findToolForRole`'s return shape or its one existing call site. MUST apply the identical
 * skip-if-it-doesn't-report-the-tool test `findToolForRole` applies, and in the same
 * side-iteration order -- review round 1 caught an earlier version that matched on role alone,
 * so a role matching two sides where only the second reports the tool (e.g. a host with both
 * `wsl:Debian` and `wsl:Ubuntu`) could name the WRONG side: `findToolForRole` correctly skips
 * `wsl:Debian` to find the tool on `wsl:Ubuntu`, but the naive version returned `wsl:Debian`'s
 * name regardless -- exactly the misleading-qualifier failure #666 exists to eliminate. */
function findSideNameForRole(
  sidecar: Sidecar | undefined,
  role: string,
  toolName: string,
): string | undefined {
  if (!sidecar) return undefined;
  for (const side of sidecar.sides) {
    if (!sideMatchesRole(side.side, role)) continue;
    if (side.tools.some((t) => t.name === toolName)) return side.side;
  }
  return undefined;
}

/** The `role` entries in `roles` that produced `status`, when the roles genuinely disagree --
 * `[]` when there's only one applicable role, or when every role shares the same status (#666:
 * "a host whose applicable roles agree ... gets no qualifier anywhere"). This is the single
 * predicate both `compare()`'s action text and `issueTitle`/the page's badge consult, so they
 * can't drift on when a role qualifier appears. */
export function divergentRoles(
  roles: RoleStatus[] | undefined,
  status: "behind" | "missing",
): RoleStatus[] {
  if (!roles || roles.length <= 1) return [];
  if (roles.every((r) => r.status === roles[0].status)) return [];
  return roles.filter((r) => r.status === status);
}

/** `"ok"` or `"behind"` for one found `installed` version against `target`, at `tool.match`
 * precision (`fleet-max` compares against the already-resolved fleet-max `target` via exact
 * equality). Never throws: an unparseable version can't be confirmed `ok`, so it's reported
 * `behind` rather than crashing the page on a malformed real-world inventory entry. */
function cellStatusFor(installed: string, tool: StandardTool, target: string): "ok" | "behind" {
  try {
    if (tool.match === "fleet-max") {
      return compareVersion(installed, target) === 0 ? "ok" : "behind";
    }
    return matchVersion(installed, tool.match, target);
  } catch {
    return "behind";
  }
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Compare `standard` against the fleet's `inventories` as of `now`, producing the fleet
 * matrix, the recommended-actions list, and which hosts' data is stale. */
export function compare(standard: Standard, inventories: Sidecar[], now: Date): CompareResult {
  const sidecarByHost = new Map(inventories.map((s) => [s.host, s]));
  const toolNames = Object.keys(standard.tools).sort();
  const hostNames = Object.keys(standard.hosts).sort();

  // fleet-max targets are resolved once per tool, across every host it applies to, before the
  // per-cell pass below needs them.
  const fleetMax = new Map<string, string>();
  for (const toolName of toolNames) {
    const tool = standard.tools[toolName];
    if (tool.match !== "fleet-max") continue;
    let max: string | undefined;
    for (const hostName of hostNames) {
      for (const v of findVersions(
        standard,
        sidecarByHost.get(hostName),
        hostName,
        toolName,
        tool,
      )) {
        if (max === undefined || compareVersion(v, max) > 0) max = v;
      }
    }
    if (max !== undefined) fleetMax.set(toolName, max);
  }

  const matrix: Row[] = [];
  const actions: Action[] = [];

  for (const toolName of toolNames) {
    const tool = standard.tools[toolName];
    const cells: Record<string, Cell> = {};
    // The source behind whichever role/side supplied cells[host].version -- kept OUTSIDE
    // Cell (issue #671 asks for it on Action, and Cell already has passing tests asserting
    // its exact shape via toEqual) but populated in lockstep with `version` below, so the
    // second pass can attribute a `behind` action to the same row `installed` came from.
    const sourceByHost: Record<string, string | undefined> = {};

    for (const hostName of hostNames) {
      const hostRoles = standard.hosts[hostName].roles;
      const applicableRoles = tool.applies.filter((r) => hostRoles.includes(r));
      if (applicableRoles.length === 0) {
        cells[hostName] = { status: "n/a" };
        continue;
      }

      const target = tool.match === "fleet-max" ? fleetMax.get(toolName) : tool.target;
      const sidecar = sidecarByHost.get(hostName);

      // Worst-status-wins across every applicable role, not just the ones that happened to
      // report the tool: a role whose side never reports it at all is worse than a sibling
      // role merely being out of date, so it must not be silently masked by that sibling
      // being ok (review-gate finding -- Node.js on a windows-dev+wsl host used to read "ok"
      // from the Windows side alone even when the wsl side had no Node.js entry at all).
      let anyReported = false;
      let anyUnreported = false;
      let status: "ok" | "behind" = "ok";
      let version: string | undefined;
      let source: string | undefined;
      // One entry per applicable role (#666), built alongside the worst-wins fold above without
      // changing that fold's own logic -- a role's `status` here is decided the same way the
      // fold decides it for that one role, just kept instead of only feeding the aggregate.
      const roles: RoleStatus[] = [];
      for (const role of applicableRoles) {
        const found = findToolForRole(sidecar, role, toolName);
        if (found === undefined) {
          anyUnreported = true;
          roles.push({ role, side: role, status: "missing" });
          continue;
        }
        anyReported = true;
        const side = findSideNameForRole(sidecar, role, toolName) ?? role;
        roles.push({
          role,
          side,
          status: target !== undefined ? cellStatusFor(found.version, tool, target) : "missing",
          version: found.version,
          source: found.source,
        });
        if (target !== undefined && cellStatusFor(found.version, tool, target) === "behind") {
          status = "behind";
          version = found.version;
          source = found.source;
        } else if (version === undefined) {
          version = found.version;
          source = found.source;
        }
      }
      sourceByHost[hostName] = source;

      if (!anyReported || target === undefined) {
        cells[hostName] = { status: "missing", target, roles };
        continue;
      }
      if (anyUnreported) {
        cells[hostName] = { status: "missing", target, roles };
        continue;
      }
      cells[hostName] = { status, version, target, roles };
    }

    matrix.push({ tool: toolName, match: tool.match, cells });

    for (const hostName of hostNames) {
      const cell = cells[hostName];
      if (cell.status !== "behind" && cell.status !== "missing") continue;
      const status = cell.status;
      // `cell.target` is only ever undefined for a `fleet-max` tool nobody in the fleet has
      // reported yet -- `behind` can't reach this branch with an undefined target (see the
      // `versions.length === 0 || target === undefined` gate above).
      const standardNote =
        cell.target !== undefined
          ? `${tool.match} ${cell.target}`
          : `${tool.match} (no fleet data yet)`;
      // A role qualifier appears in the host label ONLY when this cell's applicable roles
      // genuinely disagree (#666) -- a host whose roles agree (both behind, or one role) reads
      // exactly as it did before this feature existed.
      const divergent = divergentRoles(cell.roles, status);
      const hostLabel =
        divergent.length > 0
          ? `${hostName} (${divergent.map((r) => r.side).join(", ")})`
          : hostName;
      const text =
        status === "behind"
          ? `Upgrade ${toolName} on ${hostLabel}: ${cell.version} -> ${cell.target} (standard: ${standardNote})`
          : `Install ${toolName} on ${hostLabel} (standard: ${standardNote})`;
      actions.push({
        id: `${hostName}|${toolName}|${status}`,
        host: hostName,
        tool: toolName,
        status,
        installed: status === "behind" ? cell.version : undefined,
        target: cell.target,
        match: tool.match,
        // Absent for `missing`, matching `installed`'s own absence there -- there is no
        // single row to attribute a source to when nothing was confirmed installed.
        source: status === "behind" ? sourceByHost[hostName] : undefined,
        roles: cell.roles,
        text,
      });
    }
  }

  const stale = inventories
    .filter((s) => now.getTime() - new Date(s.generated).getTime() > FOURTEEN_DAYS_MS)
    .map((s) => s.host)
    .sort();

  return { matrix, actions, stale };
}
