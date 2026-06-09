# Maintaining WatchDog

This runbook keeps the public repository easy to contribute to.

## Branches

- Keep `main` deployable.
- Delete remote branches after their PR is merged or closed, unless they are an
  active release branch.
- Branch names should use `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, or
  `chore/`.
- Prefer squash merges so `main` stays readable.

Useful checks:

```bash
git fetch --prune origin
git branch -r --merged origin/main
git branch -r --no-merged origin/main
```

## Issues

- Issues should describe actionable bugs, features, docs work, or test gaps.
- Add `bug`, `enhancement`, `documentation`, `test`, `dependencies`, `ci`,
  `help wanted`, or `good first issue` labels where useful.
- Close duplicates with a link to the canonical issue.
- Do not use public issues for vulnerabilities. Point reporters to
  [`SECURITY.md`](../SECURITY.md).

## Pull Requests

- Require the PR template for non-trivial changes.
- Keep titles Conventional Commit shaped.
- Ask for tests when code changes shared behavior, public routes, parsers,
  database contracts, or security-sensitive paths.
- Close stale bot PRs when a newer grouped dependency PR or maintainer cleanup
  branch supersedes them.

## Security Alerts

- Keep Dependabot alerts, Dependabot security updates, dependency review, and
  CodeQL enabled.
- Fix critical and high alerts before adding new feature work.
- Prefer source fixes over dismissals. Dismiss only false positives, and include
  a short explanation.
- Re-run CodeQL after security-sensitive changes merge.
