# Push Automation (`python push`)

This repo now includes a root-level script named `push` that automates release publishing:

1. Runs a UI build check (`npm --prefix ui run build`) unless skipped.
2. Bumps `ui/package.json` version (and `ui/package-lock.json`).
3. Commits changes.
4. Creates a Git tag like `v1.2.9`.
5. Pushes branch + tag to GitHub.
6. Your existing GitHub Action (`.github/workflows/release.yml`) detects the tag and publishes the release build for auto-update users.

## Quick Start

From repo root:

```powershell
python push
```

Default behavior:
- `patch` bump (for example `1.2.8 -> 1.2.9`)
- stages all changes with `git add -A`
- runs UI build check before release
- commit message: `chore(release): vX.Y.Z`

## Common Commands

Patch release:

```powershell
python push
```

Minor release:

```powershell
python push --bump minor
```

Explicit version:

```powershell
python push --version 1.3.0
```

Preview actions only:

```powershell
python push --dry-run
```

Skip build check:

```powershell
python push --no-build-check
```

Only stage version files (not all changes):

```powershell
python push --no-stage-all
```

## Environment Variables (Optional)

You can set defaults without putting secrets in source:

- `PUSH_DEFAULT_BUMP` (default: `patch`)
- `PUSH_PREID` (for prerelease identifiers)
- `PUSH_REMOTE` (default: `origin`)
- `PUSH_BRANCH` (default: current git branch)
- `PUSH_COMMIT_MESSAGE` (custom commit message)
- `PUSH_TAG_PREFIX` (default: `v`)
- `PUSH_RUN_BUILD_CHECK` (`true`/`false`, default: `true`)

Example (PowerShell):

```powershell
$env:PUSH_DEFAULT_BUMP="minor"
python push
```

For persistent Windows user env vars:

```powershell
setx PUSH_DEFAULT_BUMP "minor"
```

## What Each Function Does (Script Internals)

- `read_bool_env(name, default)`: Parses boolean env vars like `true/false`.
- `run(cmd, ...)`: Runs shell commands with consistent logging and error handling.
- `require_tool(name)`: Ensures required tools (`git`, `npm`) exist.
- `git_output(*args)`: Helper to run git and return stdout as text.
- `ensure_project_layout()`: Verifies expected repo files exist.
- `ensure_inside_git_repo()`: Confirms execution inside a git worktree.
- `get_current_branch()`: Reads current git branch and blocks detached HEAD.
- `validate_semver(version)`: Validates explicit version format.
- `get_package_version()`: Reads current app version from `ui/package.json`.
- `bump_version(version, bump, preid)`: Executes npm version bump without auto-tag.
- `run_build_check(skip)`: Runs or skips pre-release UI build check.
- `stage_files(stage_all)`: Stages either all changes or only version files.
- `ensure_staged_changes()`: Prevents empty commits.
- `commit_changes(message)`: Creates release commit.
- `ensure_tag_absent(tag)`: Blocks duplicate tag creation.
- `create_tag(tag, message)`: Creates annotated release tag.
- `push_branch_and_tag(remote, branch, tag)`: Pushes branch and tag.
- `parse_args()`: Defines command-line options.
- `main()`: Orchestrates full release flow.

## Security Notes (Important For Shared ChatGPT Account)

- This script runs **locally on your machine**; it does not send tokens to ChatGPT.
- Do **not** hardcode tokens in `push`, repo files, or chat messages.
- Prefer GitHub auth via:
  - SSH key (`git@github.com:...`) or
  - Git Credential Manager for HTTPS auth.
- Keep `GH_TOKEN` as a **GitHub repository secret** (Actions setting), not in code.
- Use a dedicated fine-scoped GitHub token for automation (minimum required scopes).
- Enable 2FA on GitHub and review active sessions/tokens periodically.

## Suggested Improvements

1. Add changelog generation (for example from conventional commits) before tagging.
2. Add automated tests/lint checks before release (not only `npm run build`).
3. Add branch guard (`main` only) to prevent accidental releases from feature branches.
4. Add optional GitHub Actions run polling so the script waits until release success/failure.
5. Add signed tags and signed commits for stronger supply-chain trust.
