# Releasing Animal Channel Studio

## Prerequisites

- A GitHub repository named `animal-channel-studio` under your account
- A GitHub Personal Access Token with `repo` scope added as a repository secret named `GH_TOKEN`
- The `owner` field in `ui/package.json` → `build.publish` must match your GitHub username

## Release Steps

1. **Bump the version** in `ui/package.json`:
   ```
   "version": "1.3.0"
   ```

2. **Commit the version bump:**
   ```
   git add ui/package.json
   git commit -m "chore: bump version to 1.3.0"
   ```

3. **Tag the release:**
   ```
   git tag v1.3.0
   ```

4. **Push the commit and the tag:**
   ```
   git push && git push --tags
   ```

5. **GitHub Actions** picks up the `v*` tag, runs `electron-builder`, and publishes the installer as a GitHub Release automatically.

6. **Running apps** detect the new release on their next launch and display the update banner.

## Testing Auto-Update

1. Install an older build on a test machine.
2. Publish a new version tag (e.g. `v0.0.2-test`).
3. Launch the installed app — within a minute it should detect the update and show the "Restart & Install" banner.
