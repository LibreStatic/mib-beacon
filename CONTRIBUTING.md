# Contributing to MIB Beacon

MIB Beacon is GPL-3.0-or-later software. Contributions are accepted under the
same license using the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
rather than a CLA.

## Developer Certificate of Origin

Sign every commit with `git commit --signoff`. The resulting `Signed-off-by`
line certifies that you have the right to submit the contribution under the
project license. Do not sign for another person.

## Development workflow

1. Install Node.js 20+ and pnpm 10.
2. Run `pnpm install --frozen-lockfile`.
3. Make a focused change with regression tests.
4. Run `pnpm release:prepare` when dependencies or the version change.
5. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
   `pnpm verify:licenses`, and `pnpm verify:release-metadata`.

Do not commit credentials, packet captures containing credentials, generated
private keys, vendor MIB collections, or resolver cache contents. Network
resolution must remain disabled until the user gives consent. New platform
permissions require a written rationale and release-manifest verification.

Bug fixes should include the failure mode, root cause, regression test, and any
platform-specific manual verification in the pull request.
