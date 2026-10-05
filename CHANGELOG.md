# Changelog

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
  from the repo root (that file does not exist here; tools-site keeps that test).
