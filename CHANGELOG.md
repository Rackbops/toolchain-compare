# Changelog

## 0.1.1

Re-synced with `Rackbops/Tooling` `main` at commit `2687db6130cf42d4a8d3b787dbb559247325b011`
(Tooling#877 / #881, "govern the Claude Code CLI").

- `PackageManager` gains `"native"` (the vendor's own installer; its package id is the installer
  URL), and `parseStandard` accepts it as a `packages` manager. Before this, a standard carrying a
  `native` entry was rejected as an unknown manager.
- The tests that pin it (`compare.test.ts`, `standard.test.ts`) come along from the same commit.

## 0.1.0

First release: the comparator extracted from `Rackbops/Tooling`'s `tools-site`
(`src/features/toolchain/compare.ts` and `standard.ts`, Tooling#880) at Tooling `main` commit
`7f0f285e2b4d37e8fafd613c45b71e499dda3db6`.

- `compare`, `compareVersion`, `matchVersion`, `parseVersion`, `divergentRoles`, and the
  `Standard` / `Sidecar` / `CompareResult` types.
- `parseStandard` and `StandardParseError`.
- The logic is byte-identical to the Tooling source at that commit. The only differences are the
  header comment of `compare.ts` (rephrased for consumers) and the relative import in `standard.ts`
  (`./compare.js`, as Node ESM requires).
- The tests are the Tooling ones, minus the one that parsed Tooling's own `toolchain-standard.json`
  from the repo root (that file does not exist here; tools-site keeps that test). Their relative
  imports carry the `.js` extension and `compare.test.ts`'s vitest import is sorted (biome).
