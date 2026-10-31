# Engineering roadmap

_Last reviewed: 2026-10-31. Scope: `cui-and-jing/blog`._

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

## Current iteration: share searches typed before the index loads (2026-10-31)

- **Finding:** Before the asynchronous search index is ready, input events call `apply()` but return early. Once the index arrives, `fetchIndex()` calls `apply(false)`; results render from the typed query, yet the `q` URL parameter remains absent. Copying the address or reloading loses the search.
- **Change:** Let the first successful index render synchronize the current input value with `history.replaceState`, without adding a Back entry. Existing deep links, type filters, failed-index fallback and IME behavior stay intact.
- **Regression:** Intercept and delay the real search-index request in Chromium; type before readiness, then release the request. Verify the results, selected category and shareable URL, with no additional history entry. Preserve all Quality, game and CSS/JS transfer budgets; merge only after latest-head CI succeeds, then verify main Quality and same-SHA Pages deployment.

## Completed: avoid duplicate browser-history entries on search type filters (2026-10-31)

- **Finding:** Search's article/note/all filter pushes a new history entry even when the clicked type is already selected. Repeating the same click creates identical Back entries, requiring unnecessary Back presses before returning to another filter or page.
- **Change:** Ignore clicks on the active type before changing the URL, preserving intentional navigation and the existing type and query parameters.
- **Regression:** Extend the Chromium search-type browser test to select notes twice, verify no change to history length/selection/URL, and then verify that switching to all and pressing Back still restores notes.
- **Release:** No dependency, content, CSS, routes, or game changes. Preserve built JS gzip and first-visit limits; require latest PR Quality and clean mergeability before squash, then same-SHA main Quality and Pages build/deploy.

## Completed: reset reading preferences after cross-tab storage clear (2026-10-31)

- **Finding:** Reading preferences already synchronize when another tab writes or removes the `settings` key, but `localStorage.clear()` emits a storage event with a null key. The listener ignores it. Also, View Transition delays applying theme changes until after the synchronous `saveSettings()` call, so the new theme may not persist after reload.
- **Change:** Treat null-key storage events as preference updates and repaint all controls. Save preferences *inside* the View Transition update callback, after the new selection is applied.
- **Regression:** Use two real Chromium tabs to test custom theme/font/size/leading changes, `removeItem`, and `localStorage.clear()`; verify all defaults and `aria-pressed`. Test that the theme selected through the UI is saved after its transition.
- **Release:** Isolated branch, no dependencies, routes, games or CSS changes; retain all size budgets. Merge only after full latest-head Quality success and clean PR, then verify main Quality and Pages deploy using the same merge SHA.

## Completed: synchronize recent searches across tabs (2026-10-31)

- **Finding:** Search history is read from localStorage when a search page loads or its input changes. A second tab can remove, clear, or add history without triggering a refresh in a currently open search tab, leaving stale visible suggestions.
- **Change:** Listen for browser storage events on the existing search-history key (including storage.clear's null key) and re-render the existing history area. Preserve typed queries, focus, saved-search limit, and private-mode fallback.
- **Regression:** Open real Chromium tabs on the search route, seed history in one tab and verify a second displays it; then remove the key, add new history, and clear all storage from the first tab. Check the second tab updates without navigation or input changes.
- **Release:** Small search-only change. Do not raise CSS/JS or transfer caps. Require latest PR Quality and clean merge before squash; then main Quality and Pages build/deploy must match the merge SHA.

## Completed: respect cross-tab reading-list removal (2026-10-31)

- **Finding:** A tab that previously saved a post retains an in-memory copy. When another tab deletes the saved-post key or clears site storage, the first tab receives the storage event, but `readBookmarks()` falls back to the stale in-memory copy when the key is absent, leaving bookmark buttons and the saved-only filter wrong.
- **Change:** Clear the in-memory fallback only after `localStorage.setItem` succeeds. Keep the session copy when a write is denied; after persistence succeeds, a missing key correctly indicates a later removal. Preserve the existing versioned storage key and same-tab behavior.
- **Regression:** Chromium opens two tabs, saves a post, activates the saved-only filter, and clears saved-posts from the second tab using both `removeItem` and `clear`. Verify the first tab receives correct unpressed bookmarks, zero count, empty filtered list and unchanged saved-only URL. Run full Quality and maintain all performance and deployment gates.
- **Release:** Isolated branch, no extra dependency, content, CSS, routes or games, and no raised budgets. Merge only when latest-head Quality is green and the PR is clean; then verify main Quality and Pages for the same merge SHA.

## Completed: preserve note copy failure feedback (2026-10-31)

- **Finding:** The shared note-copy handler falls back to legacy `execCommand('copy')` if Clipboard API permission is unavailable. If both paths fail, it only updates the screen-reader live region and clears `location.hash`; sighted users receive no visible failure feedback and a failed copy silently alters a deep-link fragment.
- **Change:** Show a temporary `复制失败` label using the existing 1.6-second reset, keep the descriptive live-region announcement, and never mutate the current URL on clipboard failure. Keep successful modern and legacy copy paths, routes, styles, dependencies, post content, and games unchanged.
- **Regression:** Real Chromium checks simulate permission rejection, legacy success, and both copy APIs failing. Verify the visible label, live announcement, focus recovery, unchanged hash, and successful fallback. Require full Quality including built budgets, a11y, keyboard, game and transfer checks.
- **Release:** Work only on an isolated branch. Do not merge unless the latest PR-head Quality passes and is conflict-free. After Squash Merge, verify successful main Quality and Pages build/deploy at the identical merged SHA.

## Completed: repair note detail copy-link control (2026-10-31)

- **Finding:** The notes timeline uses `data-note-link`, which the shared `NoteCopy` click delegate recognizes. The dedicated note page instead renders `data-note-copy data-link`; clicking its visible “复制链接” button triggers no handler, no clipboard copy and no confirmation.
- **Change:** Align the detail-page button with the shared component's existing `data-note-link` contract. Keep both routes, the user-facing labels, the click delegate and the clipboard fallback behavior unchanged.
- **Regression:** Add real Chromium click-and-clipboard contract checks on both the timeline and a dedicated note. Verify the absolute copied URL, visible success label and accessible announcement. Keep the full Quality, games, accessibility, CSS/JS and transfer budgets.
- **Release:** No new dependency, route, content, game, stylesheet or runtime script. Merge only after full Quality success for the exact latest PR SHA, then verify main Quality and Pages build/deploy for the same merge SHA.

## Completed: remove inert mobile lightbox offsets (2026-10-31)

- **Finding:** The 720px media block assigns `top` and `right` to `.lightbox-close`, but that button is a statically positioned flex child. The viewport position is actually controlled by its `position: fixed` parent, `.lightbox-tools`. These offsets never move the button, yet occupy space near the strict CSS gzip limit.
- **Change:** Delete only the ineffective child offsets. Preserve the parent toolbar's fixed 22px placement, the 44px close hit target, image zoom and keyboard navigation, desktop layout, and the original small-screen behavior.
- **Regression:** Extend the real Chromium lightbox test at 390px, confirming static close positioning, the fixed toolbar inset, 44×44 hit area and zero horizontal overflow. Retain all Quality checks, including CSS gzip and first-visit network budgets.
- **Release:** No dependency, content, game, route, runtime JavaScript, or budget change. Merge only after latest-head PR Quality is fully successful and mergeable; then validate main Quality and Pages build/deploy on the same merge SHA.

## Completed: share decorative sheen motion rules (2026-10-31)

- **Finding:** Card cover sheen and game cover sheen pseudo-elements repeat exactly the same positioning, transform, opacity and pointer-event declarations. Only widths and gradient strengths differ. Keeping duplicate blocks adds CSS maintenance cost close to the strict gzip cap.
- **Change:** Share the identical pseudo-element declarations while preserving the original distinct widths, gradients, hover animations and reduced-motion boundary. Do not change navigation, routes, game logic, JS or dependencies.
- **Budget correction:** The first complete PR run failed because CSS gzip was 21,508/21,504 bytes. The initial removal of the redundant `sheen` 0% keyframe reduced raw CSS but did not reduce gzip; further omit the duplicate terminal opacity (inherited from the pseudo-element base) and the identity start of `drift` (inherited from the hero base). Keep the 18%/100% sheen motion target, the drift target and strict limits. Full CI/browser validation remains mandatory.
- **Regression:** Chromium tests the two pseudo-elements' computed motion properties and their distinct gradient strengths with motion enabled. Keep all existing visual, keyboard, accessibility, game, print and network budget checks.
- **Release:** The built CSS gzip budget is authoritative, not source character savings. Do not raise any cap. Merge only on fully successful latest PR-head Quality, then verify main Quality and Pages deployment on the exact merge SHA.

## Completed: print collapsed article details (2026-10-31)

- **Finding:** MDX Details uses native closed `<details>`, but print CSS does not reveal its content. Chromium PDF output omits the hidden instructions entirely even though the component describes them as printable.
- **Change:** Override the native `::details-content` visibility only in print media. Preserve interactive `open` state and every normal-screen layout, with no JavaScript, route, content, game or dependency changes. The pseudo-element is supported in modern Chromium, Firefox and Safari; older browsers may still omit closed details.
- **Regression:** Extend the existing real-browser print check to verify closed and expanded details in screen vs print media and restoration after leaving print mode. A local Chromium PDF fixture confirmed the content is absent before and present after the CSS rule. Keep all Quality and size budgets, and verify PR/head mergeability, main Quality and same-SHA Pages deployment.

## Completed: preserve external URLs in printed articles (2026-10-30)

- **Finding:** The print stylesheet appends a URL to external prose links, but a later print-only `.prose a.external-link::after { display: none; }` cancels it. The normal screen icon also uses a masked, fixed-size pseudo-element, which is unsuitable for text in print.
- **Change:** Reset the screen-only pseudo-element styling before adding the printable address, and remove the print rule that hides the address. Keep normal screen icons, local links, routes, posts, games, and dependencies unchanged.
- **Regression:** Run actual Chromium screen and print media checks for a styled external link and a local link in the existing keyboard/browser suite; retain all CSS gzip, JS, fonts, builds, a11y, games and transfer budgets.
- **Release gate:** Require latest PR-head Quality success and mergeability, then successful main Quality and Pages build/deploy for one exact merge SHA.

## Completed: remove hidden back-to-top offset rules (2026-10-30)

- **Finding:** At up to 1080px, the floating `.to-top` button is hidden because the mobile bottom action bar owns the same action. A later <=900px media query still sets its `right` and `bottom` offsets, which cannot affect layout while `display: none` is active.
- **Change:** Remove only that unreachable <=900px offset block in `motion.css`, leaving the <=1080px visibility rule, existing desktop floating button, and mobile bar intact. No dependency, route, game, content, JavaScript, or size-cap changes.
- **Regression:** Chromium verifies the floating button is hidden and the bottom bar shown at 320/360/390px and the 900/1080px boundaries, then switches back to the floating button at 1081px. Full PR Quality must also pass built CSS gzip and all browser/accessibility/game/release checks.
- **Release:** Never merge a failed or pending latest-head CI. Squash merge only if mergeable, then verify successful main Quality and GitHub Pages on the exact same SHA.

## Completed: consolidate note stylesheet declarations (2026-10-30)

- **Finding:** The note stylesheet has repeated footer, timestamp, grid-frame and link declarations while the generated CSS gzip is near its strict 21 KiB limit. Initial grouped-selector changes reduced source bytes but failed full CI: the latest failed PR run measured **21,515 / 21,504 gzip bytes**.
- **Change:** Keep the original selector specificity, combine identical grid-frame declarations across the home note strip, tag-note list and archive-note list, and remove two earlier `text-decoration: none` declarations that are already overridden by later underlined link rules. This follow-up removes another 273 source bytes without changing breakpoints, routes, content, runtime JavaScript, dependencies or games.
- **Regression:** Check effective final declarations for affected note selectors against the previous PR source; six target selectors match after the follow-up refactor. Require the **latest PR head SHA** to pass the full Quality suite, including built CSS gzip, fonts, build, links, RSS, games, accessibility, mobile keyboard/browser and first-visit budget checks. Source byte savings alone are not a pass.
- **Release:** Keep this PR in draft until verified. Do not raise resource budgets or merge failing tests; after a green, mergeable PR, squash-merge and require main Quality plus Pages build/deploy on the exact merge SHA.

## Completed: mobile dialog touch targets (2026-10-30)

- **Finding:** The article font-size toolbar already has 44px targets, but the shared reading-settings dialog still renders its segmented choices at 30px high, and the settings, navigation and shortcut dialogs have 28px close buttons. The settings footer actions are also small touch targets.
- **Change:** On narrow screens, make settings segments at least 44x44, all three shared dialog close buttons 44x44, and settings footer actions 44px high; keep existing compact desktop sizing and all settings logic.
- **Regression:** Extend the real Chromium keyboard/accessibility suite at 320px and 390px, checking all eleven settings choices, footer actions and dialog close hit rectangles, no horizontal overflow, real touch changes to reading size, touch-to-close behavior and expanded-state updates. Existing keyboard, game, build and budget gates remain mandatory.
- **Guardrails:** No content, URL, dependency, browser JavaScript, game, or budget changes. Require latest PR Quality success and mergeability, then main Quality and Pages deployment success on the exact merge SHA.

## Completed: article font-size controls on touch screens (2026-10-30)

- **Finding:** The three inline article font-size buttons were only 32x24 CSS pixels, below the 44x44 touch target used elsewhere on mobile. Their visible A-/A/A+ text also hid the intended size choice from screen readers.
- **Change:** Give the size buttons a minimum 44x44 target on narrow screens or coarse pointers, keep compact desktop dimensions, and add accessible size labels without changing the reading preference logic.
- **Regression:** On 320px and 390px Chromium touch viewports, measure the actual button rectangles and page overflow; tap large text, reload to verify persistence, and use Enter to restore the normal setting. The existing desktop switching, axe, fonts, performance budgets, games and link checks remain mandatory.
- **Guardrails:** no runtime JavaScript, dependency, route, post/note, or game changes. Retain the CSS/JS and first-visit budgets; require latest PR Quality and mergeability, then verify main Quality and Pages on the exact merge SHA.

## Completed: trustworthy article revision metadata (2026-10-30)

- **Finding:** The sitemap and search discovery already ignore an `updated` timestamp earlier than publication, but article JSON-LD, Open Graph metadata and the visible footer can still describe that older edit as the latest revision. This creates conflicting published/modified dates when content authors correct frontmatter.
- **Change:** Normalize the article's effective revision date with the existing `activityDate` helper before producing schema, metadata or footer labels. Omit the optional modified-time tag and update label unless the update is strictly later than publication.
- **Regression:** Extend the build-time activity contract with older/newer/invalid update fixtures and per-article comparisons of emitted JSON-LD, publish/modify meta tags, footer and sitemap effective dates.
- **Guardrails:** no routes, content, dependencies, CSS, browser JS, games or budget changes. Merge only after full latest-head PR Quality success; verify main Quality and Pages deploy on the merge SHA.

## Completed: mobile search history touch and keyboard usability (2026-10-30)

- **Finding:** Search history chips and the clear-history button use small padding and had no 44px minimum touch target. On narrow phones, these controls were harder to activate than the nearby search input clear button, and the clear-history control's accessible name was ambiguous.
- **Change:** Give both saved-query chips and clear-history control a minimum 44px touch height, retain flexible chip wrapping, ensure the clear action is at least 44px wide and distinguish its accessible label from clearing the search query. Preserve saved-query ordering, URL behavior and local-only storage.
- **Regression:** Chromium tests at 320px and 390px seed stored queries, measure actual hit rectangles and horizontal overflow, tap a query to restore results/URL, activate clear history by keyboard and verify persistence after reload. Existing axe, search, game, font, size and first-visit transfer gates stay mandatory.
- **Guardrails:** no changes to posts, notes, routes, dependencies, games, or JavaScript functionality; keep the existing CSS and JS caps. Squash-merge only after the latest PR Quality fully passes; verify main Quality and Pages publish on the exact merged SHA.

## Completed: homepage and series editorial freshness (2026-10-30)

- **Finding:** The shared recent-update feeds now recognize later article edits, but the homepage hero's "最近更新" date still uses publication-only dates. Series discovery also ranks series by most recent publication rather than latest article revision, despite the sitemap treating edits as fresh content.
- **Change:** Reuse one build-time activity-date reducer across the homepage hero and series ordering. Preserve original publication dates in the visible series date range, chapter sequence, archive, and article cards. An edited older series may move higher in discovery without rewriting its publication history.
- **Regression:** Add newer/older revision and note-only fixtures plus emitted-homepage/search-index date parity. Compare series listing and homepage previews with source metadata activity, without assuming a particular publication-date order for ties.
- **Guardrails:** no new routes, frontend JavaScript/CSS, dependencies, game changes, content edits, or raised size budgets. Require latest PR Quality, then verify main Quality and Pages for one merge SHA.

## Completed: editorial activity in recent discovery (2026-10-30)

- **Finding:** The sitemap now advances for a revised article, but both “最近更新” entry points still sort articles only by their original publication date. An edited older article can stay buried. Shared search entry labels also imply article-only search even though notes are indexed.
- **Change:** Sort mixed recent sidebar and empty-search recommendations by the later of publication and article `updated`; retain the original published date in the search index and expose later editorial updates as optional metadata. Announce updated-date suggestions to assistive technology and clarify search entry labels.
- **Regression:** Add newer/older edit fixtures, compare built links, order and dates to the emitted search index, retain stable ties, article exclusion and note discovery.
- **Guardrails:** no frontend JS/CSS, content, route, dependency, game or budget changes. Merge only after latest PR Quality passes, then verify main Quality and Pages against the exact squash-merge SHA.

## Completed: mixed-content sitemap freshness (2026-10-30)

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
