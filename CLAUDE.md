# toolchain-compare -- Claude Instructions

`@rackbops/toolchain-compare`: the fleet toolchain comparator (`src/compare.ts`, `src/standard.ts`),
extracted from `Rackbops/Tooling`'s `tools-site` (Tooling#880). See
[`docs/PURPOSE.md`](docs/PURPOSE.md).

My personal `~/.claude/CLAUDE.md` governs *how I work* -- the review gate, escalation, commit
mechanics, tool routing, shell choice. Not restated here; this file covers only what a session
needs to know about the code in this repo.

## Ground truth

The Python module `toolchain_standard.py` in `Rackbops/Tooling` is the reference for the
version-matching semantics; `src/compare.test.ts` carries the fixture table shared with its
`test_match_semantics`. **A semantic change starts in the Python reference and in this fixture
table together, never in one alone.**

## Gotchas

- **ESM, `module: nodenext`:** relative imports need the `.js` extension (`./compare.js`), or `tsc`
  fails with TS2835 and the emitted `dist/` would not load under Node.
- **The comparator is shared logic, not a copy.** `Rackbops/Tooling`'s tools-site and artifact-console
  import it; a behaviour change is a version bump consumers adopt, so keep it additive or follow
  `release.sh`'s breaking-marker rules (`feat!:` bumps the minor while major is 0).
- **No runtime dependencies, no I/O, no DOM.**

## Testing & checks

`just check` / `pnpm check` (biome, `tsc --noEmit`, `vitest run`, `tsc`) mirrors CI
(`.github/workflows/ci.yml`).

## Release

Same machinery as `Rackbops/rackbops-node-app-kit`: a push to `main` runs `release.yml`, which bumps
the version from conventional commits touching `src/`, tags `vX.Y.Z` and creates the GitHub release;
the tag triggers `publish.yml` (npm OIDC trusted publishing: organization `Rackbops`, repository
`toolchain-compare`, workflow `publish.yml`). `RELEASE_TOKEN` unset makes `release.yml` an inert
no-op. The very first publish needs the one-time npm bootstrap (an interactive `0.0.0` placeholder,
then the Trusted Publisher): Tooling's `docs/non-addon-repo-scaffold.md` section 16.
