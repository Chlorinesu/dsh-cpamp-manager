# Third-party notices

## CPA Manager Plus

This project is an unofficial frontend adaptation, not an official CPAMP or DeepSeek release.

- Upstream project: https://github.com/seakee/CPA-Manager-Plus
- Pinned source: https://github.com/seakee/CPA-Manager-Plus/tree/v1.14.10
- Copyright (c) 2026 Seakee
- License: MIT, retained in `upstream/LICENSE`
- Original source archive provenance and checksum: `upstream/VERSION`
- The original frontend source remains under `upstream/src` in the repository. Harness-specific changes live separately in `frontend` and `build-tools`.
- CPAMP artwork and upstream-distributed provider glyphs remain unmodified resources from that pinned source. No trademark ownership or endorsement is claimed; applicable third-party marks remain the property of their respective owners.

## Bundled browser dependencies

The generated `upstream/DEPENDENCY_LICENSES.txt` includes the license texts and notices for dependencies actually bundled into the browser artifact. Host React and ReactDOM are shared with Harness rather than redistributed as a second runtime.

The npm distributions of `@uiw/react-codemirror` and `@uiw/codemirror-extensions-basic-setup` declare MIT but omit the repository license. The exact upstream v4.25.12 license is retained in `upstream/licenses/react-codemirror.LICENSE`, with its source URL alongside it.

## Packaging

The runtime `.tgz` includes compiled JavaScript, Host code, display resources and license material. It contains no CPAMP server credentials, user profiles, browser data, dependency installation directory, local package-manager cache, or install scripts. The source repository contains development and test files separately; the runtime archive is not intended to run the source-development test suite without its build dependencies.
