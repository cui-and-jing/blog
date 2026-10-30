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

## Current iteration: mixed-content sitemap freshness (2026-10-30)

- **Finding:** The archive and authors pages both list articles and notes, but `/archive/` sitemap lastmod advanced only for article changes; `/authors/` lacked a lastmod value. Publishing a newer note could therefore leave stale metadata on both pages. An article `updated` date earlier than its publication date could also incorrectly move its lastmod backwards.
- **Change:** Set aggregate lastmod for archive and authors to the latest article or note. Preserve article-only post/series routes and note-only note routes. Compare article publication and update dates and use the later valid date.
- **Regression:** Add mixed, post-only and note-only sitemap fixtures; exercise older/newer update dates and verify every built sitemap lastmod against content metadata. The existing `npm run sitemap:check` runs in Quality and local preflight.
- **Guardrails:** no site route, frontend asset, dependency, article content, game, or budget changes. Require a fully green latest PR SHA, then verify the main Quality and Pages publish on the same merge SHA.

## Completed: series-first related reading (2026-10-30)

- **Finding:** Article series timelines obey `seriesOrder`, but the article "接着读" related cards ignored that order and ranked same-series items by publication date. Opening the first chapter could therefore suggest chapter 3 before chapter 2.
- **Change:** Reuse the existing `sortByOrder` rule. Prefer subsequent chapters in ascending series order, then previous chapters in reverse proximity; fill remaining cards with the existing category/tag relevance and date ordering. Continue excluding the current article.
- **Regression:** Compare each generated series timeline to actual related-card hrefs on all of its articles, including the first, middle and final chapter; forbid duplicates/self links. Run the contract in PR/main Quality and local preflight.
- **Guardrails:** no dependency, content, routes, client JavaScript/CSS, game, or budget changes. Require all latest PR checks to pass, then verify main Quality and Pages use the same merge SHA.

## Completed: search fallback covers notes and posts (2026-10-30)

- **Finding:** Empty search suggestions say “最近更新” but offer only articles, even when notes were published more recently. On the homepage a separate article-only card group also says “最近更新”, despite a dedicated latest-note section.
- **Change:** Use the newest three published posts and notes in the no-result search fallback, consistently ordered with the sidebar; add screen-reader type prefixes and dates. Rename the homepage article-only heading “最近文章” to distinguish it from mixed updates.
- **Regression:** Check the built search fallback hrefs, dates and accessible type labels against the published search index; assert that the homepage article section is accurately named. Run in PR/main Quality and local preflight.
- **Guardrails:** no new routes, dependencies, frontend JavaScript or CSS, content changes, game changes, or budget increases. Merge only on latest green PR SHA and verify main Quality + Pages on the exact merge commit.

## Completed: unified article + note recent updates (2026-10-30)

- **Finding:** The sidebar says “最近更新” but lists articles only. The latest notes (October 20 and 22) never appear, even though notes are first-class content in search, tags and archive.
- **Change:** Merge posts and notes into a stable newest-first sidebar list, keep the existing four-item limit, and omit the currently opened article on article detail pages. Add screen-reader-only type prefixes without changing visual card styles.
- **Regression:** Compare actual homepage and every article sidebar order with the published search index, preserving equal-day ordering and excluding only the current article. Gate in PR/main Quality and local preflight.
- **Guardrails:** no dependency, route, source content, game, CSS, or browser JS changes, and no budget increase. Merge on the latest green PR SHA; verify main Quality and Pages on the exact merge commit.

## Completed: consistent post + note tag discovery (2026-10-30)

- **Finding:** The tag directory and tag detail pages aggregate articles and notes, but the sidebar and empty-search suggestions counted only articles. Note-only tags could disappear from these entry points despite having working tag pages.
- **Change:** Reuse `collectTags(posts, notes)` in both surfaces, preserving the shared popularity and locale tie-break order. Keep the existing 14-tag sidebar and 6-tag search limits.
- **Regression:** After building, compare homepage and article sidebar links and search suggestions with the corresponding prefix of the emitted tag directory. Run this audit in CI and local preflight alongside existing link, accessibility, browser and budget gates.
- **Guardrails:** no route, content, dependency, frontend JS/CSS, font source or budget changes. Merge only on a fully green latest PR SHA; verify main Quality and Pages deployment on the merge SHA.

## Completed: local preflight and CI release/feed parity (2026-10-30)

- **Finding:** CI validates the Pages release gate and built article/note RSS, but local `npm run preflight` skipped both. A developer could receive a misleading all-green local report before a red PR check.
- **Change:** run the same deployment gate before type checking and the same RSS full-text/permalink contract after sitemap checks in local preflight. No change to runtime assets or published URLs.
- **Regression:** add an independent source-level contract in the PR Quality workflow to ensure both checks remain present, in the expected order, and also exist in CI; test that removing either local check or the CI RSS step makes the contract fail.
- **Guardrails:** keep existing size budgets and the main Quality→Pages same-SHA publish gate. Require PR Quality success before merge and verify main Quality and Pages for the exact merge SHA.

## Completed: sitemap note-tag freshness and discovery contract (2026-10-30)

- **Finding:** tag pages aggregate both articles and notes, but `astro.config.mjs` sitemap lastmod included only article tags. New note-only tags had no lastmod and shared tags could report stale article timestamps; the tag index could similarly lag behind a newer note.
- **Change:** factor build-only frontmatter scanning and lastmod aggregation into a shared helper. Update note-driven tag detail/index timestamps, preserve article/archive/series behavior and home/notes freshness; exclude noindex 404 fallback from sitemap.
- **Regression:** run fixture-based tests for shared tags, note-only tags, untagged notes and date precedence. After every build, compare expected routes and lastmod with emitted sitemap XML, validate robots sitemap URL and noindex exclusions; integrate in PR/main Quality and local preflight.
- **Guardrails:** no frontend JS/CSS, URL, game, content or dependency change. Do not relax budgets or Pages gate; merge only after latest PR Quality succeeds and verify main Quality + Pages use the exact merge SHA.

## Completed: shared table observation and long-prose browser regression (2026-10-30)

- **Finding:** each Markdown table created its own ResizeObserver and scroll event listener, in addition to an initial measurement callback. Long technical articles can contain many tables; these observers and callbacks need not scale per table.
- **Change:** keep the established idle scheduling and Safari timeout fallback unchanged. Reuse one ResizeObserver for all prose tables and its initial observation notification for scrollability; avoid duplicate per-table scroll listeners and first-frame measurements. Keep the original lightbox handlers and URL behavior unchanged. Proposed broader rewrites were rejected when they exceeded the strict JS gzip budget.
- **Regression:** Chromium injects a second table before enhancement, verifies both share a single ResizeObserver and horizontal-scroll state reacts to width changes. It also preserves code-copy, lightbox mouse/Enter/Space, zoom, next/previous and Esc checks, plus search, mobile, games, RSS and transfer budget gates.
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
