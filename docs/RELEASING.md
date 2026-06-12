# Releasing

Quick reference for shipping a new version.

## Cut a release

1. Bump `package.json` version: `3.6.0` → `3.7.0` (semver: minor for features, patch for fixes).
2. Commit: `git commit -am "v3.7.0"`.
3. Tag and push: `git tag v3.7.0 && git push --tags`.
4. The `Build and Release` workflow runs:
   - tests + lint on Linux,
   - then `electron-builder --win` on Windows,
   - publishes the `.exe`, `latest.yml`, and blockmap to a draft Release with an
     auto-generated changelog (filtered git log between previous and current tag).
5. Open the Release on GitHub, edit notes if needed, and publish.

`electron-updater` reads `latest.yml` from the Release; once published, every running
desktop app picks up the update on next check.

## Code-signing (Windows) — not yet enabled

Without signing, Windows shows a SmartScreen warning ("Unknown publisher") on first
install. To remove it we'd need:

- An OV or EV code-signing certificate (~80–500 USD/year). EV is faster to clear
  reputation but ships on a hardware token.
- Two GitHub Actions secrets: `WIN_CERT_BASE64` (the `.pfx` base64-encoded) and
  `WIN_CERT_PASSWORD`.
- electron-builder picks them up automatically when present:
  ```yaml
  env:
    CSC_LINK: ${{ secrets.WIN_CERT_BASE64 }}
    CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
  ```

Decision pending: cost vs. install friction.

## Smoke build locally

```
npm run build:dir
```

Produces `dist/win-unpacked/Ghetto Blaster.exe` without packaging the NSIS
installer — useful to confirm the build passes before tagging.

## Rollback

If a bad release ships, delete the GitHub Release (or mark it pre-release) and
delete the `latest.yml` asset. Clients won't pick it up. Then publish a patched
version with a higher number.
