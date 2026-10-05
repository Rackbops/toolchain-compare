import { describe, expect, it } from "vitest";
import {
  compare,
  compareVersion,
  divergentRoles,
  matchVersion,
  parseVersion,
  type Sidecar,
  type Standard,
} from "./compare.js";

// --- version-matching semantics: the fixture table shared with toolchain_standard.py's
// test_match_semantics (tests/test_toolchain_standard.py) -- ported verbatim so the two
// implementations can't silently drift apart. ------------------------------------------------
describe("matchVersion (ports toolchain_standard.py's matches())", () => {
  it.each([
    ["3.14.7", "3.14", "minor", "ok"],
    ["3.12.14", "3.14", "minor", "behind"],
    ["26.5.1", "26", "major", "ok"],
    ["24.0.0", "26", "major", "behind"],
    ["2.50.0", "2.50.0", "exact", "ok"],
    ["2.49.0", "2.50.0", "exact", "behind"],
  ] as const)("matchVersion(%s, %s, %s) -> %s", (installed, target, match, expected) => {
    expect(matchVersion(installed, match, target)).toBe(expected);
  });
});

describe("compareVersion", () => {
  it("pads a missing trailing component with 0", () => {
    expect(compareVersion("3.14", "3.14.0")).toBe(0);
    expect(compareVersion("3.14.1", "3.14")).toBe(1);
    expect(compareVersion("3.13", "3.14")).toBe(-1);
  });

  it("rejects an unparseable version", () => {
    expect(() => compareVersion("3.x", "3.14")).toThrow();
  });
});

describe("parseVersion", () => {
  it("accepts 1-3 dot-separated non-negative integers, rejects everything else", () => {
    expect(parseVersion("3")).toEqual([3]);
    expect(parseVersion("3.14")).toEqual([3, 14]);
    expect(parseVersion("3.14.7")).toEqual([3, 14, 7]);
    expect(parseVersion("v3.14")).toBeNull();
    expect(parseVersion("3.14-rc1")).toBeNull();
  });
});

// --- compare(): the fleet matrix -------------------------------------------------------------
//
// Fixture fleet: Melody (windows-dev + wsl, HAS a sidecar), MILE (windows-dev only, NO sidecar
// at all -- the "host with no data yet" case), nitro (linux-server, HAS a sidecar).
const standard: Standard = {
  schemaVersion: 1,
  roles: ["windows-dev", "wsl", "linux-server"],
  hosts: {
    Melody: { roles: ["windows-dev", "wsl"] },
    MILE: { roles: ["windows-dev"] },
    nitro: { roles: ["linux-server"] },
  },
  tools: {
    // minor: behind on Melody (3.12.10 vs target minor 3.14), missing on MILE (no sidecar).
    Python: { applies: ["windows-dev"], match: "minor", target: "3.14" },
    // major, applies to BOTH roles Melody carries -- exercises the worst-status-wins policy
    // when a host reports the tool on more than one applicable side.
    "Node.js": { applies: ["windows-dev", "wsl"], match: "major", target: "26" },
    // fleet-max, applies everywhere -- exercises fleet-max resolution across hosts and sides.
    Git: { applies: ["windows-dev", "wsl", "linux-server"], match: "fleet-max" },
    // exact, linux-server only -- n/a on Melody/MILE, ok on nitro.
    Docker: { applies: ["linux-server"], match: "exact", target: "27.3.1" },
    // fleet-max, applies to windows-dev, but nobody in the fixture fleet reports it: exercises
    // "fleet-max never resolved anywhere" without crashing on an undefined target.
    Cargo: { applies: ["windows-dev"], match: "fleet-max" },
  },
  unmanaged: [],
};

const NOW = new Date("2026-09-11T12:00:00Z");
const RECENT = "2026-09-10T12:00:00Z";

const melody: Sidecar = {
  schemaVersion: 1,
  host: "Melody",
  hostname: "Melody-PC",
  os: "windows",
  generated: RECENT,
  sides: [
    {
      side: "windows",
      tools: [
        {
          name: "Python",
          category: "Languages",
          version: "3.12.10",
          path: "C:\\Python312\\python.exe",
          source: "winget",
        },
        {
          name: "Node.js",
          category: "Languages",
          version: "24.0.0",
          path: "C:\\nodejs\\node.exe",
          source: "winget",
        },
        {
          name: "Git",
          category: "VCS & infra",
          version: "2.50.0",
          path: "C:\\Git\\bin\\git.exe",
          source: "winget",
        },
      ],
      uncatalogued: [],
    },
    {
      side: "wsl:Ubuntu",
      tools: [
        {
          name: "Node.js",
          category: "Languages",
          version: "26.1.0",
          path: "/usr/bin/node",
          source: "apt",
        },
        {
          name: "Git",
          category: "VCS & infra",
          version: "2.49.0",
          path: "/usr/bin/git",
          source: "apt",
        },
      ],
      uncatalogued: [],
    },
  ],
};

const nitro: Sidecar = {
  schemaVersion: 1,
  host: "nitro",
  hostname: "roshne-Nitro-AN515-55",
  os: "linux",
  generated: RECENT,
  sides: [
    {
      side: "linux",
      tools: [
        {
          name: "Git",
          category: "VCS & infra",
          version: "2.50.0",
          path: "/usr/bin/git",
          source: "apt",
        },
        {
          name: "Docker",
          category: "VCS & infra",
          version: "27.3.1",
          path: "/usr/bin/docker",
          source: "apt",
        },
      ],
      uncatalogued: [],
    },
  ],
};

function row(result: ReturnType<typeof compare>, tool: string) {
  const r = result.matrix.find((m) => m.tool === tool);
  if (!r) throw new Error(`no row for ${tool}`);
  return r;
}

describe("compare()", () => {
  // MILE carries no sidecar at all.
  const result = compare(standard, [melody, nitro], NOW);

  it("marks a tool ok when the installed version meets its target", () => {
    expect(row(result, "Docker").cells.nitro).toEqual({
      status: "ok",
      version: "27.3.1",
      target: "27.3.1",
      roles: [
        { role: "linux-server", side: "linux", status: "ok", version: "27.3.1", source: "apt" },
      ],
    });
  });

  it("marks a tool behind when the installed version misses its target", () => {
    expect(row(result, "Python").cells.Melody).toEqual({
      status: "behind",
      version: "3.12.10",
      target: "3.14",
      roles: [
        {
          role: "windows-dev",
          side: "windows",
          status: "behind",
          version: "3.12.10",
          source: "winget",
        },
      ],
    });
  });

  it("marks a tool missing when it applies to the host but isn't reported (no sidecar at all)", () => {
    expect(row(result, "Python").cells.MILE).toEqual({
      status: "missing",
      target: "3.14",
      roles: [{ role: "windows-dev", side: "windows-dev", status: "missing" }],
    });
    expect(row(result, "Git").cells.MILE).toEqual({
      status: "missing",
      target: "2.50.0",
      roles: [{ role: "windows-dev", side: "windows-dev", status: "missing" }],
    });
  });

  it("marks a tool n/a when it doesn't apply to the host's roles -- never confused with missing", () => {
    // Docker applies only to linux-server; Melody and MILE carry no linux-server role.
    expect(row(result, "Docker").cells.Melody).toEqual({ status: "n/a" });
    expect(row(result, "Docker").cells.MILE).toEqual({ status: "n/a" });
  });

  it("resolves fleet-max as the highest version reported anywhere the tool applies", () => {
    // Git: Melody windows 2.50.0, Melody wsl 2.49.0, nitro linux 2.50.0 -> fleet-max 2.50.0.
    expect(row(result, "Git").cells.nitro).toEqual({
      status: "ok",
      version: "2.50.0",
      target: "2.50.0",
      roles: [
        { role: "linux-server", side: "linux", status: "ok", version: "2.50.0", source: "apt" },
      ],
    });
  });

  it("applies worst-status-wins when a host reports a tool on more than one applicable side", () => {
    // Node.js on Melody: windows side 24.0.0 (behind target major 26), wsl side 26.1.0 (ok).
    // The host-level cell must report the WORST side, not silently prefer the healthy one.
    expect(row(result, "Node.js").cells.Melody).toEqual({
      status: "behind",
      version: "24.0.0",
      target: "26",
      roles: [
        {
          role: "windows-dev",
          side: "windows",
          status: "behind",
          version: "24.0.0",
          source: "winget",
        },
        { role: "wsl", side: "wsl:Ubuntu", status: "ok", version: "26.1.0", source: "apt" },
      ],
    });
    // Same worst-status-wins logic applies to a fleet-max tool: Melody's wsl Git (2.49.0) is
    // behind the resolved fleet-max (2.50.0) even though its windows side (2.50.0) is ok.
    expect(row(result, "Git").cells.Melody).toEqual({
      status: "behind",
      version: "2.49.0",
      target: "2.50.0",
      roles: [
        { role: "windows-dev", side: "windows", status: "ok", version: "2.50.0", source: "winget" },
        { role: "wsl", side: "wsl:Ubuntu", status: "behind", version: "2.49.0", source: "apt" },
      ],
    });
  });

  it("reports a fleet-max tool nobody has ever installed as missing, with no target crash", () => {
    expect(row(result, "Cargo").cells.Melody).toEqual({
      status: "missing",
      target: undefined,
      roles: [{ role: "windows-dev", side: "windows-dev", status: "missing" }],
    });
  });

  it("produces one action per behind/missing cell, with structured fields (not just text)", () => {
    const behind = result.actions.find((a) => a.id === "Melody|Python|behind");
    expect(behind).toEqual({
      id: "Melody|Python|behind",
      host: "Melody",
      tool: "Python",
      status: "behind",
      installed: "3.12.10",
      target: "3.14",
      match: "minor",
      source: "winget",
      roles: [
        {
          role: "windows-dev",
          side: "windows",
          status: "behind",
          version: "3.12.10",
          source: "winget",
        },
      ],
      text: "Upgrade Python on Melody: 3.12.10 -> 3.14 (standard: minor 3.14)",
    });

    const missing = result.actions.find((a) => a.id === "MILE|Python|missing");
    expect(missing).toEqual({
      id: "MILE|Python|missing",
      host: "MILE",
      tool: "Python",
      status: "missing",
      installed: undefined,
      target: "3.14",
      match: "minor",
      source: undefined,
      roles: [{ role: "windows-dev", side: "windows-dev", status: "missing" }],
      text: "Install Python on MILE (standard: minor 3.14)",
    });
  });

  it("carries the sidecar row's source onto a behind action -- issue #671", () => {
    // Melody's Python row is reported with source "winget" (fixture above); the action for
    // its behind cell must carry that same source, not just the version, so the filer's fix
    // hint can follow how the tool was actually installed instead of guessing from the OS.
    const behind = result.actions.find((a) => a.id === "Melody|Python|behind");
    expect(behind?.source).toBe("winget");

    // A missing action has no confirmed row to attribute a source to -- absent, matching
    // `installed`'s own absence there.
    const missing = result.actions.find((a) => a.id === "MILE|Python|missing");
    expect(missing?.source).toBeUndefined();
  });

  it("never emits an action for an ok or n/a cell", () => {
    expect(result.actions.some((a) => a.id.endsWith("|ok"))).toBe(false);
    expect(result.actions.some((a) => a.id.endsWith("|n/a"))).toBe(false);
  });
});

// --- partial role coverage: a host can carry more than one applicable role (Melody is
// windows-dev + wsl), and a required role whose side never reports the tool at all must not be
// silently masked by a sibling role reporting a healthy version (review-gate finding). ---------
describe("compare() with partial role coverage", () => {
  const twoRoleStandard: Standard = {
    schemaVersion: 1,
    roles: ["windows-dev", "wsl"],
    hosts: { Melody: { roles: ["windows-dev", "wsl"] } },
    tools: { "Node.js": { applies: ["windows-dev", "wsl"], match: "major", target: "26" } },
    unmanaged: [],
  };

  it("reports missing when one applicable side reports ok but a sibling side never reports the tool", () => {
    // windows: Node.js 26.5.0 (ok) -- wsl side is present but has no Node.js entry at all.
    const melodyPartial: Sidecar = {
      schemaVersion: 1,
      host: "Melody",
      hostname: "Melody-PC",
      os: "windows",
      generated: RECENT,
      sides: [
        {
          side: "windows",
          tools: [
            {
              name: "Node.js",
              category: "Languages",
              version: "26.5.0",
              path: "C:\\nodejs\\node.exe",
              source: "winget",
            },
          ],
          uncatalogued: [],
        },
        { side: "wsl:Ubuntu", tools: [], uncatalogued: [] },
      ],
    };
    const result = compare(twoRoleStandard, [melodyPartial], NOW);
    // Must NOT read "ok" from the windows side alone -- the wsl side was scanned (it's present
    // in `sides`) and has no Node.js at all, which is worse than a mere version mismatch.
    expect(row(result, "Node.js").cells.Melody).toEqual({
      status: "missing",
      target: "26",
      roles: [
        { role: "windows-dev", side: "windows", status: "ok", version: "26.5.0", source: "winget" },
        // The wsl side IS present in `sides` but reports no Node.js -- `side` falls back to the
        // role name, same as when the side is absent entirely (see the next test).
        { role: "wsl", side: "wsl", status: "missing" },
      ],
    });
  });

  it("reports missing when the sibling side is entirely absent from the sidecar", () => {
    const melodyNoWsl: Sidecar = {
      schemaVersion: 1,
      host: "Melody",
      hostname: "Melody-PC",
      os: "windows",
      generated: RECENT,
      sides: [
        {
          side: "windows",
          tools: [
            {
              name: "Node.js",
              category: "Languages",
              version: "26.5.0",
              path: "C:\\nodejs\\node.exe",
              source: "winget",
            },
          ],
          uncatalogued: [],
        },
      ],
    };
    const result = compare(twoRoleStandard, [melodyNoWsl], NOW);
    expect(row(result, "Node.js").cells.Melody).toEqual({
      status: "missing",
      target: "26",
      roles: [
        { role: "windows-dev", side: "windows", status: "ok", version: "26.5.0", source: "winget" },
        { role: "wsl", side: "wsl", status: "missing" },
      ],
    });
  });
});

// --- per-role status and role-qualified actions (#666): a host can carry more than one
// applicable role for one tool, and the worst-wins headline above tells a viewer nothing about
// WHICH role produced it. `roles` and `divergentRoles` fix that without changing the headline. --
describe("compare() with per-role status (#666)", () => {
  const roleStandard: Standard = {
    schemaVersion: 1,
    roles: ["windows-dev", "wsl", "linux-server"],
    hosts: {
      Melody: { roles: ["windows-dev", "wsl"] },
      nitro: { roles: ["linux-server"] },
    },
    tools: { Git: { applies: ["windows-dev", "wsl", "linux-server"], match: "fleet-max" } },
    unmanaged: [],
  };

  function gitSidecar(
    host: string,
    side: string,
    os: "windows" | "linux",
    version: string,
  ): Sidecar {
    return {
      schemaVersion: 1,
      host,
      hostname: host,
      os,
      generated: RECENT,
      sides: [
        {
          side,
          tools: [{ name: "Git", category: "VCS & infra", version, path: "/git", source: "apt" }],
          uncatalogued: [],
        },
      ],
    };
  }

  it("divergent roles: cell reads the worst role, but roles + action.text name BOTH sides (the issue's own fixture)", () => {
    // Melody: windows 2.55.0 (ok), wsl:Ubuntu 2.53.0 (behind). nitro: linux 2.55.0 -- sets
    // fleet-max to 2.55.0 without being the row under test.
    const melodyGit: Sidecar = {
      schemaVersion: 1,
      host: "Melody",
      hostname: "Melody-PC",
      os: "windows",
      generated: RECENT,
      sides: [
        {
          side: "windows",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.55.0",
              path: "C:\\Git\\bin\\git.exe",
              source: "winget",
            },
          ],
          uncatalogued: [],
        },
        {
          side: "wsl:Ubuntu",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.53.0",
              path: "/usr/bin/git",
              source: "apt",
            },
          ],
          uncatalogued: [],
        },
      ],
    };
    const result = compare(
      roleStandard,
      [melodyGit, gitSidecar("nitro", "linux", "linux", "2.55.0")],
      NOW,
    );

    expect(row(result, "Git").cells.Melody).toEqual({
      status: "behind",
      version: "2.53.0",
      target: "2.55.0",
      roles: [
        { role: "windows-dev", side: "windows", status: "ok", version: "2.55.0", source: "winget" },
        { role: "wsl", side: "wsl:Ubuntu", status: "behind", version: "2.53.0", source: "apt" },
      ],
    });

    const action = result.actions.find((a) => a.id === "Melody|Git|behind");
    expect(action?.text).toContain("on Melody (wsl:Ubuntu):");
    expect(action?.text).toBe(
      "Upgrade Git on Melody (wsl:Ubuntu): 2.53.0 -> 2.55.0 (standard: fleet-max 2.55.0)",
    );
  });

  it("both sides behind: no divergence, so no parenthesised role anywhere", () => {
    // Melody: both sides 2.53.0. nitro: 2.55.0 -- sets fleet-max to 2.55.0, so BOTH of Melody's
    // sides are behind it, agreeing with each other.
    const melodyBothBehind: Sidecar = {
      schemaVersion: 1,
      host: "Melody",
      hostname: "Melody-PC",
      os: "windows",
      generated: RECENT,
      sides: [
        {
          side: "windows",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.53.0",
              path: "C:\\Git\\bin\\git.exe",
              source: "winget",
            },
          ],
          uncatalogued: [],
        },
        {
          side: "wsl:Ubuntu",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.53.0",
              path: "/usr/bin/git",
              source: "apt",
            },
          ],
          uncatalogued: [],
        },
      ],
    };
    const result = compare(
      roleStandard,
      [melodyBothBehind, gitSidecar("nitro", "linux", "linux", "2.55.0")],
      NOW,
    );

    const cell = row(result, "Git").cells.Melody;
    expect(cell.roles).toEqual([
      {
        role: "windows-dev",
        side: "windows",
        status: "behind",
        version: "2.53.0",
        source: "winget",
      },
      { role: "wsl", side: "wsl:Ubuntu", status: "behind", version: "2.53.0", source: "apt" },
    ]);
    expect(divergentRoles(cell.roles, "behind")).toEqual([]);

    const action = result.actions.find((a) => a.id === "Melody|Git|behind");
    expect(action?.text).toBe(
      "Upgrade Git on Melody: 2.53.0 -> 2.55.0 (standard: fleet-max 2.55.0)",
    );
    expect(action?.text).not.toContain("(wsl");
  });

  it("single-role host: roles has exactly one entry and the text is byte-identical to before #666", () => {
    // nitro carries only linux-server -- Git applies there too, so nitro's own cell can never
    // have more than one applicable role no matter how many roles OTHER hosts contribute.
    const melodyOk = gitSidecar("Melody", "windows", "windows", "2.55.0");
    const nitroBehind = gitSidecar("nitro", "linux", "linux", "2.53.0");
    const result = compare(roleStandard, [melodyOk, nitroBehind], NOW);

    const cell = row(result, "Git").cells.nitro;
    expect(cell.roles).toHaveLength(1);
    expect(cell.roles).toEqual([
      { role: "linux-server", side: "linux", status: "behind", version: "2.53.0", source: "apt" },
    ]);

    const action = result.actions.find((a) => a.id === "nitro|Git|behind");
    // Pinned exact string: single-role actions must read identically to every action filed
    // before this feature existed.
    expect(action?.text).toBe(
      "Upgrade Git on nitro: 2.53.0 -> 2.55.0 (standard: fleet-max 2.55.0)",
    );
  });

  it("missing on one side, ok on the other: roles carries missing with side = the role name, action qualified", () => {
    // Melody: windows 2.55.0 (ok) -- wsl side never reports Git at all.
    const melodyPartial: Sidecar = {
      schemaVersion: 1,
      host: "Melody",
      hostname: "Melody-PC",
      os: "windows",
      generated: RECENT,
      sides: [
        {
          side: "windows",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.55.0",
              path: "C:\\Git\\bin\\git.exe",
              source: "winget",
            },
          ],
          uncatalogued: [],
        },
        { side: "wsl:Ubuntu", tools: [], uncatalogued: [] },
      ],
    };
    const result = compare(roleStandard, [melodyPartial], NOW);

    const cell = row(result, "Git").cells.Melody;
    expect(cell.status).toBe("missing");
    expect(cell.roles).toEqual([
      { role: "windows-dev", side: "windows", status: "ok", version: "2.55.0", source: "winget" },
      { role: "wsl", side: "wsl", status: "missing" },
    ]);

    const action = result.actions.find((a) => a.id === "Melody|Git|missing");
    expect(action?.text).toBe("Install Git on Melody (wsl) (standard: fleet-max 2.55.0)");
  });

  it("names the side that actually reports the tool when a role matches more than one side (review-gate finding)", () => {
    // Two sides both match role "wsl" (sideMatchesRole checks a "wsl:" prefix) -- wsl:Debian
    // reports no Git at all, wsl:Ubuntu does. `side` must name wsl:Ubuntu (the side the version
    // actually came from), never wsl:Debian just because it matched the role first: an earlier
    // version of findSideNameForRole picked the first role-matching side unconditionally, while
    // findToolForRole (correctly) skips a non-reporting side to find the one that does --
    // exactly the "qualifier names the wrong side" failure #666 exists to eliminate.
    const melodyTwoWsl: Sidecar = {
      schemaVersion: 1,
      host: "Melody",
      hostname: "Melody-PC",
      os: "windows",
      generated: RECENT,
      sides: [
        {
          side: "windows",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.55.0",
              path: "C:\\Git\\bin\\git.exe",
              source: "winget",
            },
          ],
          uncatalogued: [],
        },
        { side: "wsl:Debian", tools: [], uncatalogued: [] },
        {
          side: "wsl:Ubuntu",
          tools: [
            {
              name: "Git",
              category: "VCS & infra",
              version: "2.53.0",
              path: "/usr/bin/git",
              source: "apt",
            },
          ],
          uncatalogued: [],
        },
      ],
    };
    const result = compare(roleStandard, [melodyTwoWsl], NOW);
    const wslRole = row(result, "Git").cells.Melody.roles!.find((r) => r.role === "wsl");
    expect(wslRole).toEqual({
      role: "wsl",
      side: "wsl:Ubuntu",
      status: "behind",
      version: "2.53.0",
      source: "apt",
    });
  });

  it("divergentRoles: [] for a single role or fewer than 2 entries, [] when all roles agree", () => {
    expect(divergentRoles(undefined, "behind")).toEqual([]);
    expect(
      divergentRoles([{ role: "linux-server", side: "linux", status: "behind" }], "behind"),
    ).toEqual([]);
    expect(
      divergentRoles(
        [
          { role: "windows-dev", side: "windows", status: "behind" },
          { role: "wsl", side: "wsl:Ubuntu", status: "behind" },
        ],
        "behind",
      ),
    ).toEqual([]);
  });
});

// --- #877: the Claude Code CLI as a fleet-max tool. A self-contained fixture (its own standard
// and sidecars) so no shared fixture above changes meaning. Stands in for the live store, which
// has no Claude Code rows until artifact-console#673's inventory row ships. A fixture run of
// fleet-max grading, not a guard for the `native` change itself (compare() never reads
// `packages`).
describe("compare() grades the Claude Code CLI fleet-max (#877)", () => {
  const claudeStandard: Standard = {
    schemaVersion: 1,
    roles: ["windows-dev", "linux-server"],
    hosts: {
      Melody: { roles: ["windows-dev"] },
      MILE: { roles: ["windows-dev"] },
      nitro: { roles: ["linux-server"] },
    },
    tools: {
      "Claude Code CLI": {
        applies: ["windows-dev", "linux-server"],
        match: "fleet-max",
        packages: { native: "https://claude.ai/install.sh" },
      },
    },
    unmanaged: [],
  };
  const claudeSidecar = (
    host: string,
    os: "windows" | "linux",
    side: string,
    version: string,
  ): Sidecar => ({
    schemaVersion: 1,
    host,
    hostname: host,
    os,
    generated: RECENT,
    sides: [
      {
        side,
        tools: [
          {
            name: "Claude Code CLI",
            category: "AI tooling",
            version,
            path: "claude",
            source: "installer",
          },
        ],
        uncatalogued: [],
      },
    ],
  });
  // Melody reports an older version than nitro; MILE reports nothing at all.
  const result = compare(
    claudeStandard,
    [
      claudeSidecar("Melody", "windows", "windows", "2.1.100"),
      claudeSidecar("nitro", "linux", "linux", "2.1.283"),
    ],
    NOW,
  );

  it("resolves the fleet maximum and grades the lower host behind", () => {
    expect(row(result, "Claude Code CLI").cells.nitro).toMatchObject({
      status: "ok",
      version: "2.1.283",
      target: "2.1.283",
    });
    expect(row(result, "Claude Code CLI").cells.Melody).toMatchObject({
      status: "behind",
      version: "2.1.100",
      target: "2.1.283",
    });
  });

  it("reports a host that doesn't report it as missing for an applicable role", () => {
    expect(row(result, "Claude Code CLI").cells.MILE).toMatchObject({
      status: "missing",
      target: "2.1.283",
    });
  });
});

// --- mutation guards: these tests exist specifically to fail if either invariant below is
// broken, per the review gate's mutation-test requirement. -----------------------------------
describe("mutation guards", () => {
  it("kills an inverted behind comparison (an ok installed version must not read as behind)", () => {
    const result = compare(standard, [nitro], NOW);
    // Docker on nitro is an exact match at its target -- inverting the equality check in
    // cellStatusFor/matchVersion would flip this to "behind".
    expect(row(result, "Docker").cells.nitro.status).toBe("ok");
  });

  it("kills treating n/a as missing (a non-applicable cell must stay n/a)", () => {
    const result = compare(standard, [melody, nitro], NOW);
    // Docker doesn't apply to Melody's roles at all -- collapsing n/a into missing would make
    // this "missing" (and would wrongly generate an Install action for it).
    expect(row(result, "Docker").cells.Melody.status).toBe("n/a");
    expect(result.actions.some((a) => a.host === "Melody" && a.tool === "Docker")).toBe(false);
  });
});

// --- staleness: the 14-day boundary, tested at 13 (not stale) and 15 (stale) days old --------
describe("stale hosts", () => {
  const tool: Standard = {
    schemaVersion: 1,
    roles: ["linux-server"],
    hosts: { nitro: { roles: ["linux-server"] } },
    tools: { Docker: { applies: ["linux-server"], match: "exact", target: "27.3.1" } },
    unmanaged: [],
  };
  const base: Sidecar = {
    schemaVersion: 1,
    host: "nitro",
    hostname: "nitro",
    os: "linux",
    generated: "",
    sides: [
      {
        side: "linux",
        tools: [
          {
            name: "Docker",
            category: "x",
            version: "27.3.1",
            path: "/usr/bin/docker",
            source: "apt",
          },
        ],
        uncatalogued: [],
      },
    ],
  };
  const now = new Date("2026-09-15T00:00:00Z");

  it("13 days old is not stale", () => {
    const generated = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000).toISOString();
    const result = compare(tool, [{ ...base, generated }], now);
    expect(result.stale).toEqual([]);
  });

  it("15 days old is stale", () => {
    const generated = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const result = compare(tool, [{ ...base, generated }], now);
    expect(result.stale).toEqual(["nitro"]);
  });
});
