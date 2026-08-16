# Nightly maintenance — scope for autonomous fixes

You are running unattended in CI, triggered by a failed check (dependency
audit or type check) captured in `maintenance-findings.txt` in the repo root.
Your job: make the **minimal** fix, verify it, and stop. A human reviews the
draft PR before anything merges — you are not deploying, you are proposing.

## Allowed (fix these directly, on the branch already checked out)
- Dependency CVE patches, **same major version line only**, via the
  `package.json` `overrides` block — this repo already carries this pattern
  (`uuid`, `brace-expansion`, `js-yaml`, `nanoid`); follow it, pin with `^`,
  never an open-ended `>=` (an open range previously jumped `js-yaml` and
  `nanoid` to unrelated major versions on `npm install` — verify the resolved
  version in `package-lock.json` after install and correct the range if it
  drifted past the intended major).
- Only apply a CVE fix if the advisory has an actual published patched
  version (check `first_patched_version` on the GitHub Advisory, e.g. via
  `https://api.github.com/advisories/GHSA-...`) and the vulnerable package is
  actually reachable at runtime in the shipped app, not just a build-time-only
  transitive dependency. If neither holds, report it instead of "fixing" it.
- TypeScript errors (`npx tsc --noEmit` failures) that are mechanical —
  a bad import, a missing type, a stale prop shape.
- Small reliability bugs in the same class already fixed in this repo: a
  missing guard before an action that requires verified residency (see
  `lib/residency.ts` — `isVerifiedForCurrentNeighborhood` / `goVerify()`),
  a crash from an unguarded null/undefined access on a screen mount path.

## Forbidden — do not touch, do not fix, only report
- `lib/residency.ts`, `lib/attestation.ts`, ZK proof screens
  (`app/onboarding/**/zk-proof*`), or anything that changes *how* residency
  standing is granted or checked — you may add a missing *use* of an existing
  guard (matching an established call site elsewhere in the app), never
  change what the guard itself does.
- Any Supabase schema change. This app has no local migrations; schema lives
  in the `newclaudeversion` repo. If a fix looks like it needs a DB change,
  it's out of scope here — report it.
- Billing/Stripe, if/when introduced.
- Push notification dispatch logic, if a fix would change *who* gets
  notified or *when* — reliability fixes (retry/logging) are fine, behavior
  changes are not.
- This workflow file, its instructions file, or any other CI/CD config.
- Force-push, `--no-verify`, amending existing commits, merging your own PR.

If a finding falls in the forbidden list, or you're not confident a fix is
safe and minimal, do **not** attempt it — leave it out of the diff and
describe it in the PR body under "Could not safely fix" instead.

## Required before opening the PR
- Re-run the check that originally failed and confirm it now passes.
- Keep the diff scoped to the finding(s) you're addressing — no drive-by
  refactors, no touching unrelated files.

## PR body format
```
## Found
<what the nightly check reported>

## Changed
<files touched, one line each, what and why>

## Verification
<the check you re-ran and its result>

## Could not safely fix
<anything in-scope-looking that you left out, and why — or "none">
```
Open as a **draft** PR. Never merge it yourself.
