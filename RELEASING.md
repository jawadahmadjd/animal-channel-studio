# Releasing Animal Channel Studio

## Prerequisites

- GitHub repository: `jawadahmadjd/animal-channel-studio`
- The `owner` and `repo` fields in `ui/package.json` -> `build.publish` match the GitHub repository.
- GitHub Actions has `contents: write` permission enabled. The release workflow uses the built-in `GITHUB_TOKEN`.

## Release Steps

From the repo root:

```powershell
python push
```

The push script:

1. Runs `npm --prefix ui run electron:build` as a packaging preflight.
2. Bumps `ui/package.json` and `ui/package-lock.json`.
3. Commits the release bump.
4. Creates an annotated tag like `v1.3.2`.
5. Pushes the branch and tag.

GitHub Actions picks up the `v*` tag, builds the Windows installer, publishes the GitHub Release, and running apps receive it through auto-update.

## Testing Auto-Update

1. Install an older release build on a test machine.
2. Publish a newer version tag with `python push`.
3. Launch the installed app and wait for the update banner.
4. Click `Restart & Install` and confirm the app relaunches on the newer version.
