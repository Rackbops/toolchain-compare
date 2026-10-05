import { describe, expect, it } from "vitest";
import { parseStandard, StandardParseError } from "./standard.js";

describe("parseStandard()", () => {
  it("round-trips a good standard, packages included", () => {
    const good = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: { Melody: { roles: ["windows-dev"] } },
      tools: {
        Git: {
          applies: ["windows-dev"],
          match: "fleet-max",
          packages: { apt: "git", winget: "Git.Git" },
        },
      },
      unmanaged: ["Deno"],
      _comment: "dropped, never consumed at runtime",
    };
    expect(parseStandard(good)).toEqual({
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: { Melody: { roles: ["windows-dev"] } },
      tools: {
        Git: {
          applies: ["windows-dev"],
          match: "fleet-max",
          packages: { apt: "git", winget: "Git.Git" },
        },
      },
      unmanaged: ["Deno"],
    });
  });

  it("rejects a non-object root value", () => {
    expect(() => parseStandard([1, 2, 3])).toThrow(StandardParseError);
    expect(() => parseStandard(null)).toThrow(/expected an object/);
    expect(() => parseStandard("just a string")).toThrow(/expected an object/);
    expect(() => parseStandard(undefined)).toThrow(/expected an object/);
  });

  it("rejects a wrong schemaVersion", () => {
    const data = { schemaVersion: 2, roles: [], hosts: {}, tools: {}, unmanaged: [] };
    expect(() => parseStandard(data)).toThrow(/schemaVersion/);
  });

  // Review-gate finding: `typeof [] === "object"` and `[] !== null`, so `hosts`/`tools` need
  // their own explicit array guard -- every OTHER object-shaped check in this file already had
  // one (the root value at the top, `t.packages` below), these two didn't. Without it, an
  // array silently becomes `Object.entries`' numeric-string-keyed object (`{"0": {...}}`)
  // instead of being rejected -- exactly the "corrupted matrix instead of the safe fallback"
  // failure this module exists to prevent.
  it("rejects an array in place of hosts", () => {
    const data = { schemaVersion: 1, roles: [], hosts: [{ roles: [] }], tools: {}, unmanaged: [] };
    expect(() => parseStandard(data)).toThrow(/`hosts` must be an object/);
  });

  it("rejects an array in place of tools", () => {
    const data = {
      schemaVersion: 1,
      roles: [],
      hosts: {},
      tools: [{ applies: [], match: "fleet-max" }],
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/`tools` must be an object/);
  });

  it("rejects a non-array roles", () => {
    const data = { schemaVersion: 1, roles: "windows-dev", hosts: {}, tools: {}, unmanaged: [] };
    expect(() => parseStandard(data)).toThrow(/roles/);
  });

  it("rejects an unknown match kind", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: { Python: { applies: ["windows-dev"], match: "loose" } },
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/unknown match/);
  });

  it("rejects a non-array host roles", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: { Melody: { roles: "windows-dev" } },
      tools: {},
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/hosts\.Melody\.roles/);
  });

  it("rejects an exact/minor/major tool with no target", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: { Python: { applies: ["windows-dev"], match: "minor" } },
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/Python: match "minor" needs a target/);
  });

  it("rejects a fleet-max tool that carries a target", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: { Git: { applies: ["windows-dev"], match: "fleet-max", target: "2.50.0" } },
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/Git: match 'fleet-max' must not carry a target/);
  });

  // --- packages (#676) -------------------------------------------------------------
  it("passes a good packages map through untouched", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: {
        Git: {
          applies: ["windows-dev"],
          match: "fleet-max",
          packages: { apt: "git", winget: "Git.Git" },
        },
      },
      unmanaged: [],
    };
    expect(parseStandard(data).tools.Git.packages).toEqual({ apt: "git", winget: "Git.Git" });
  });

  it("accepts the native installer manager, its id the installer URL (#877)", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: {
        "Claude Code CLI": {
          applies: ["windows-dev"],
          match: "fleet-max",
          packages: { native: "https://claude.ai/install.sh" },
        },
      },
      unmanaged: [],
    };
    expect(parseStandard(data).tools["Claude Code CLI"].packages).toEqual({
      native: "https://claude.ai/install.sh",
    });
  });

  it("rejects an unknown packages manager", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: { Git: { applies: ["windows-dev"], match: "fleet-max", packages: { brew: "git" } } },
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/Git\.packages: unknown manager "brew"/);
  });

  it("rejects a non-string package id", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: { Git: { applies: ["windows-dev"], match: "fleet-max", packages: { apt: 3 } } },
      unmanaged: [],
    };
    expect(() => parseStandard(data)).toThrow(/Git\.packages\.apt must be a non-empty string/);
  });

  it("leaves packages undefined when absent", () => {
    const data = {
      schemaVersion: 1,
      roles: ["windows-dev"],
      hosts: {},
      tools: { Git: { applies: ["windows-dev"], match: "fleet-max" } },
      unmanaged: [],
    };
    expect(parseStandard(data).tools.Git.packages).toBeUndefined();
  });
});
