# @rackbops/toolchain-compare

The fleet toolchain comparator: grades a host's installed tools against `toolchain-standard.json`
(Rackbops/Tooling#634, TC-6). Pure TypeScript, no runtime dependencies, no DOM. See
[`docs/PURPOSE.md`](docs/PURPOSE.md) for why this is a package and not a copy.

**One semantics, and Python is the reference.** The version-matching rules (`parseVersion`,
`compareVersion`, `matchVersion`) are a TypeScript port of `matches()` / `compare_version()` in
Tooling's [`toolchain_standard.py`](https://github.com/Rackbops/Tooling/blob/main/toolchain_standard.py);
this package's `compare.test.ts` carries the fixture table shared with that module's
`test_match_semantics`, so the two cannot drift silently.

## Install

```bash
pnpm add @rackbops/toolchain-compare
```

ESM only, Node >= 24 (the code itself is runtime-neutral: it uses no Node API).

## API

Everything is a named export of the single root entry point.

| Export | Kind | What it does |
|---|---|---|
| `parseVersion(v)` | function | Dotted version string -> numeric parts, or `null` if it is not a version. |
| `compareVersion(a, b)` | function | `-1 / 0 / 1`; a missing trailing component counts as 0 (`3.14` == `3.14.0`); throws on a non-version. |
| `matchVersion(installed, match, target)` | function | `"ok"` or `"behind"` at `exact` / `minor` / `major` precision; throws on a non-version. |
| `divergentRoles(roles, status)` | function | The roles that produced `status` when a host's roles genuinely disagree, else `[]`. |
| `compare(standard, inventories, now)` | function | The fleet matrix, the recommended-actions list and the stale hosts. |
| `parseStandard(raw)` | function | Validates an untrusted JSON value into a `Standard`; throws `StandardParseError` naming the exact failing field. |
| `StandardParseError` | class | The error `parseStandard` throws. |
| `Standard`, `StandardHost`, `StandardTool`, `PackageManager`, `MatchKind` | types | The parsed `toolchain-standard.json` shape. |
| `Sidecar`, `SidecarSide`, `SidecarTool`, `SidecarUncatalogued` | types | One host's inventory sidecar. |
| `CompareResult`, `Row`, `Cell`, `RoleStatus`, `CellStatus`, `Action` | types | What `compare()` returns. |

```ts
import { compare, parseStandard } from "@rackbops/toolchain-compare";

const standard = parseStandard(await (await fetch("/api/toolchain/standard")).json());
const result = compare(standard, sidecars, new Date());
```

## Develop

```bash
pnpm install
pnpm check   # biome, typecheck, vitest, build -- what CI runs
```

Releases are cut by `.github/workflows/release.yml` from conventional-commit messages touching
`src/`, and published by `.github/workflows/publish.yml` with npm OIDC trusted publishing. See
[`CHANGELOG.md`](CHANGELOG.md).
