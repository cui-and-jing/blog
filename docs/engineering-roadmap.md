# Engineering roadmap

_Last reviewed: 2026-10-30. Scope: `cui-and-jing/blog`._

## Baseline and constraints

- Astro 7 + Markdown/MDX, deployed to GitHub Pages.
- Existing products: articles, notes, search, local reading list, reading progress, Bean Rush and Pixel Raid.
- On the latest verified main build, CSS was about 106.7 / 108 KiB (gzip 20.9 / 21 KiB); JavaScript gzip remains close to 12 / 12 KiB.
- Quality gates cover content, font subsets, types, build, size, per-page fonts, both games, axe, keyboard, and first-visit network transfer.
- Deployment is chained to **completed successful main Quality** via `workflow_run` and pinned to the verified commit SHA. Stale SHA, failed Quality and PR checks cannot publish. The currently deployed SHA should still be checked after each merge.
- The release workflow rechecks the current main SHA both before building and directly before publishing, so a delayed older successful Quality run cannot overwrite a newer release.

## Priorities

| Order | Workstream | Acceptance criteria |
| --- | --- | --- |
| P0 | Gate Pages behind successful Quality | Release only the exact latest main commit after Quality passes; test the gate on every PR. |
| P1 | Reclaim CSS and JavaScript headroom | Remove genuinely duplicated rules and event logic; retain the existing caps, visual behavior, and browser tests. |
| P2 | Stabilize browser regression tests | Test keyboard, pointer, URL history, narrow screens, reduced motion, and failures; wait for the final observable state instead of a transient event. |
| P3 | Modularize optional UI code | Audit the large layout script. Split or defer optional features only when total built size and first-visit transfer do not regress. |
| P4 | Improve content discovery | Consider navigation feedback and reading-list/search improvements after P0-P3, measured against small-screen usability. |
| Separate | Game playability | Keep Bean Rush / Pixel Raid work in focused PRs with real game smoke and deterministic combat tests. |

## Current iteration: conditional prose enhancement and lightbox delegation (2026-10-30)

- **Finding:** BaseLayout schedules a code/table enhancement idle callback even when the current route has no relevant prose elements. Image lightbox setup also attaches two activation listeners to each image, scaling event registrations linearly with image count.
- **Change:** only queue the existing idle enhancer when `.prose table` or `.prose pre` exists; retain Safari timeout fallback and existing print behavior. Share one ResizeObserver across multiple prose tables and reuse initial wrapper measurements. Keep image accessibility attributes on every rendered image but route click and Enter/Space through two delegated document listeners.
- **Regression:** Chromium verifies homepage schedules no enhancement task; a synthetic second table shares exactly one ResizeObserver with the first and retains horizontal-scroll state; styleguide keeps code copy and first/second-image activation, keyboard Enter/Space, zoom, next/previous and Esc handling. Ensure no per-image activation listeners. Verify search, mobile access, games, RSS and transfer budgets remain stable.
- **Guardrails:** no dependency, route, author content or theme changes; keep original CSS/JS caps and main Quality→Pages gate. Require latest PR SHA to pass all CI and verify merge SHA on main and Pages.

## Completed: TOC synchronization and long-page scroll efficiency (2026-10-29)

- **Reason:** the old IntersectionObserver callback scanned all TOC links and wrote class/ARIA attributes for every intersecting heading, potentially repeating writes; it also queued sidebar measurements even when mobile layouts cannot scroll the sidebar.
- **Implementation:** index raw section hrefs once, choose the topmost intersecting heading per observer batch and update only the former and new active link. Defer desktop sidebar measurement to the next frame and skip stale selections; never scroll a non-scrollable/mobile sidebar. Let CSS smooth-scroll normally but switch to auto under reduced-motion. Build the mobile TOC nav shell as HTML and clone its contents only when opening.
- **Regression:** Chromium verifies stable single active TOC and matching aria-current, no same-section writes, desktop reduced-motion behavior, mobile 390px no scroll calls and no overflow, in addition to the pre-existing mobile TOC modal tests.
- **Budget and merge:** do not change article URL/heading IDs or local data, games, dependencies, CSS/JS size limits or release gate. Require latest PR Quality success, squash merge, then main Quality and Pages success for the exact merge SHA.

## Completed: mobile reading resume and deep-link priority (2026-10-29)

- **User experience:** do not show a previous-position resume prompt when the visitor deliberately opens an article's `#section` fragment; the saved v1/v2 reading position remains intact for a future ordinary visit.
- **Touch:** keep the existing floating bar and bottom navigation layout but make both resume and dismiss actions at least 44px high/44px wide as appropriate.
- **Regression:** real Chromium at 320/360/390px checks touch rectangles, no sideways overflow, encoded Chinese heading fragments, saved-position preservation and normal revisit behavior. Existing reading accuracy, reduced motion, mobile TOC, fonts, pages and both game tests remain unchanged.
- **Guardrail:** no new dependencies, game changes or URL changes; keep CSS 108 KiB / gzip 21 KiB and JS gzip 12 KiB caps. PR latest SHA must be fully green and mergeable; verify main Quality and same-SHA Pages success.

## Completed: emitted link integrity (2026-10-29)

- **Reason:** authored Markdown link lint does not prove that generated navigation, tags/categories, cards, media files or fragment targets exist in GitHub Pages output.
- **Scope:** add dependency-free audit of emitted HTML routes and local assets with safe URL resolution, Unicode/percent-encoding, `/blog/` base enforcement, and static `#id` target checks. Standalone games continue to use their existing browser smoke tests.
- **Verification:** fixture tests for legitimate links, relative paths, Unicode routes, inline-script false positives, missing assets, missing anchors, base bypasses and unsafe schemes. Run immediately after build in both Quality and local preflight.
- **Constraints:** zero runtime JS/CSS/route changes, no dependency upgrades and no raised budgets; merge only after latest PR Quality succeeds and verify the same exact main SHA in Pages.

## Completed: shared surfaces and CSS budget (2026-10-29)

- **Decision:** CSS is within roughly 0.3 KiB of its 108 KiB hard cap; consolidate exact shared surface properties across homepage, posts, notes, archive, series and game lobby before adding any more UI.
- **Scope:** factor out only equal card background, border, radius and shadow declarations into `components.css`; keep spacing, hover, gradients, dark overrides, responsive behavior, URLs and games untouched.
- **Regression:** add Chromium computed-style comparisons against actual theme tokens in both light/dark modes; include desktop and 390px mobile with overflow checks. Existing content, fonts, RSS, builds, game smoke, axe and first-visit wire budgets remain mandatory.
- **Gate:** do not raise any budgets, update baseline screenshots without need, merge failing checks, or change dependencies. Verify latest PR SHA and subsequent main Quality/Pages SHA.

## Completed: search input and mobile clarity (2026-10-29)

- **Scope:** make IME composition safe (Enter / Arrow keys), show a meaningful empty state when only ignored words are entered, and give the mobile search-clear button a 44×44px target.
- **Regression:** Chromium covers composition before/after commit, stopword-only vs mixed queries, URL restoration, mobile clearing and pointer target dimensions. Preserve existing search index failure fallback and history.
- **Constraints:** do not modify post/notes URLs, bookmarks, reader settings, games, CSS/JS size caps or dependency versions. Validate the latest PR SHA before merge and verify main Quality + Pages after merge.

## Merge checklist for every iteration

1. Branch from current `main`; avoid unreviewed dependency upgrades. `npm run deploy:check` verifies the release gate configuration.
2. Keep URLs, existing articles, both games and local data backwards-compatible unless a change is explicitly scoped.
3. Add regression coverage for the behavior changed.
4. Require the **latest PR head SHA** to pass all Quality checks and to be mergeable.
5. Squash-merge, verify the resulting commit SHA, wait for main Quality success **before** Pages publishes, then verify both results on the same SHA. Rerun the latest main Quality run to request a fresh deployment after a temporary infrastructure issue.
6. Record any failed or deferred work honestly; never raise a budget solely to get a green CI.

## Deferred decisions

- Dependabot PRs (including TypeScript 7) need compatibility testing in separate branches; no automatic merge.
- Do not add a new game or large animated homepage feature until runtime and CSS headroom have been recovered.
