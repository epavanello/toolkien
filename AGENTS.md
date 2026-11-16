# Agent guidelines

## Git workflow

- Unless the user explicitly asks otherwise, commit and push directly to `main` on the remote
  (`git push origin HEAD:main`). Do not create a feature branch or a pull request for each change.
- Before pushing, run the checks that cover the change (`pnpm check`, `pnpm lint`, the relevant
  `pnpm test` suites) and push only when they pass.
- If the push is rejected because `main` moved, fetch and rebase onto `origin/main`, then push
  again. Never force-push `main`.
