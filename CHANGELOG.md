# Changelog

## 0.1.4

- Use npm as the installation channel and GitHub Releases for release notes.
- Simplify `pack:release` to create only the versioned npm tarball.
- Separate server configuration storage, schemas, usage events, projection, and HTTP handling.
- Separate client styles, locale dictionaries, formatting, cost dialogs, configuration state, and page components.
- Keep the existing HTTP payloads, pricing rules, configuration paths, and desktop layout.
- Test client modules through imports instead of rewriting their source text.

## 0.1.3

- Add `npm run pack:release` to create a versioned npm tarball and an identical, fixed-name GitHub Release asset.
- Use a stable latest-release download URL in the English and Chinese installation instructions.
- Document the npm and GitHub Release publishing steps.
