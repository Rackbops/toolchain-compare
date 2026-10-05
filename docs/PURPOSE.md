# Purpose

`@rackbops/toolchain-compare` is the fleet's TypeScript reference for grading a host's installed
tools against `toolchain-standard.json` (Rackbops/Tooling#634, TC-6): `parseVersion`,
`compareVersion`, `matchVersion`, `compare()` with fleet-max resolved over the store's sidecars,
and `parseStandard()` for the untrusted standard fetched at runtime. It lives in
`Rackbops/Tooling`'s `tools-site` first (`src/features/toolchain/compare.ts` and `standard.ts`);
this package is those two files extracted, with their tests.

## Why a package and not a copy

`Rackbops/artifact-console#674` needed exactly this logic in its Agents panel's Environment
section. Rather than write a second implementation, it **vendored the two files verbatim**, with
the Tooling commit and each file's sha256 recorded and a test that fails when the vendored bytes
drift from the record. That kept one semantics, but a copy is still a copy: every change to the
reference means a manual re-vendor, and the sha256 test only notices the drift after the fact.
Publishing the comparator removes the copy: tools-site and artifact-console import the same
package, and a fix lands for both by bumping a version
(`Rackbops/Tooling#880`, a give-back from artifact-console#674 / Epic artifact-console#676).

## What's in scope

The two modules (`compare` and `standard`), re-exported from one root entry point, plus the
shared fixture table that pins the version-matching semantics against
`toolchain_standard.py` (the Python module remains the reference).

## Explicit non-goals

- **Not the standard itself.** `toolchain-standard.json` and its Python validator
  (`toolchain_standard.py`) stay in `Rackbops/Tooling`; this package only reads a standard
  that a consumer hands it. Its tests therefore use inline fixtures, not that file.
- **Not the page or the issue filer.** `ToolchainPage.tsx` and `issue.ts` stay in tools-site and
  import this package.
- **No I/O, no DOM, no runtime dependencies.** Fetching the standard and the sidecars is the
  consumer's job.

## Audience

Rackbops-org consumers of the fleet toolchain inventory: `Rackbops/Tooling`'s tools-site, and
`Rackbops/artifact-console` 2.0's Agents panel.
