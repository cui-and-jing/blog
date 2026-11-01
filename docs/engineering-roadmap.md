# Engineering roadmap

_Last reviewed: 2026-11-01. Scope: `cui-and-jing/blog`._

## Baseline and constraints

- Astro 7 + Markdown/MDX, deployed to GitHub Pages.
- Existing products: articles, notes, search, local reading list, reading progress, Bean Rush and Pixel Raid.
- On the latest verified main build, CSS was about 106.7 / 108 KiB (gzip 20.9 / 21 KiB); JavaScript gzip remains close to 12 / 12 KiB.
- Quality gates cover content, font subsets, types, build, size, per-page fonts, both games, axe, keyboard, and first-visit network transfer.
- Deployment is chained to **completed successful main Quality** via `workflow_run` and pinned to the verified commit SHA. Stale SHA, failed Quality and PR checks cannot publish. The currently deployed SHA should still be checked after each merge.
- The release workflow rechecks the current main SHA both before building and directly before publishing, so a delayed older successful Quality run cannot overwrite a newer release.

## Latest audit: verify performance fixtures after removed games (2026-11-01)

- A stale manual performance profile still targeted `/games/snake/`, a removed game, and did not check HTTP 404 responses before collecting metrics. Such runs could misleadingly report an LCP/TBT result for an error page.
- Move route fixtures into a shared module, point the game profile at active Pixel Raid, reject unsuccessful navigation responses, and make Quality assert every profile route exists in `dist` after the site build.
- This protects future performance measurements but **does not** recover the nearly exhausted JS/CSS gzip headroom. Keep the 12 KiB/21 KiB gates unchanged and continue a separate resource audit.

## Priorities

| Order | Workstream | Acceptance criteria |
| --- | --- | --- |
| P0 | Gate Pages behind successful Quality | Release only the exact latest main commit after Quality passes; test the gate on every PR. |
| P1 | Reclaim CSS and JavaScript headroom | Remove genuinely duplicated rules and event logic; retain the existing caps, visual behavior, and browser tests. |
| P2 | Stabilize browser regression tests | Test keyboard, pointer, URL history, narrow screens, reduced motion, and failures; wait for the final observable state instead of a transient event. |
| P3 | Modularize optional UI code | Audit the large layout script. Split or defer optional features only when total built size and first-visit transfer do not regress. |
| P4 | Improve content discovery | Consider navigation feedback and reading-list/search improvements after P0-P3, measured against small-screen usability. |
| Separate | Game playability | Keep Bean Rush / Pixel Raid work in focused PRs with real game smoke and deterministic combat tests. |

## Completed: validate published search paths and formatted dates (2026-11-01)

- **Finding:** The build-time search contract accepted any leading-slash path, including protocol-relative or traversal-style links, and allowed arbitrary nonempty date strings. The actual client expects base-relative routes while the API formats dates as `YYYY.MM.DD`; its old fixture incorrectly used `YYYY-MM-DD`.
- **Change:** Check path type and site base for post/note entries, exclude malformed/encoded traversal and URL suffixes, and require the emitted publication/update date shape. Pass Astro's configured base into the contract; no browser JavaScript or CSS changes.
- **Regression:** Add negative fixtures for cross-base and cross-type links, traversal, malformed encoding, query/fragment tails, malformed dates and updates; keep positive post/note and generated-index checks. The full unmodified Quality pipeline, 12 KiB JS gzip gate, game and accessibility checks remain mandatory.
- **Release:** Merge only after the latest PR head completes Quality successfully, then verify main Quality and Pages publish the identical merge SHA.

## Completed: mobile search keyboard and navigation regression (2026-11-01)

- **Finding:** Search types use pushState, while query edits replace the current URL state. Desktop Back recovery is covered, but the mobile flow had no real Back/Forward assertion after changing the query on a later filter entry. The software keyboard's primary action was also left implicit.
- **Change:** Set an explicit Search action hint on the search input, with no runtime JavaScript or CSS changes. Keep the existing filtering, shared query URL and six-entry local recent-search behavior intact.
- **Regression:** At 390px, use the actual filter buttons to create history entries, edit the query, then navigate Back and Forward. Assert that query input, URL, selected button, result types/count and viewport agree, with no browser errors or duplicate entries.
- **Release gate:** Run the complete unchanged Quality pipeline, including 12 KiB gzip JS, CSS, games and a11y. Squash-merge only on green PR CI, then check Quality and Pages deployment against the exact merged SHA.

## Completed: normalize whitespace in recent searches (2026-11-01)

- **Finding:** The browser scorer treats repeated spaces, tabs and newlines as word separators, but local recent-search de-duplication compares raw trimmed strings. Queries such as `Astro   Astro` and `astro Astro` can create two history chips for equivalent terms.
- **Change:** Collapse internal whitespace to one space when storing a recent search and when comparing it with prior entries. Keep recent spelling and existing entry order, six-entry cap, privacy-mode behavior, search results and shareable URL semantics.
- **Regression:** Update the existing real-link navigation Chromium flow at 390px: seed a spaced mixed-case item, click a result after an equivalent query, and assert one normalized chip remains while an unrelated history item survives.
- **Release gate:** Do not increase the 12 KiB gzip JavaScript cap or bypass any Quality check. Squash Merge only if complete PR Quality is green; then require main Quality and Pages Build/Deploy to succeed on the same merged SHA.

## Completed: omit multiline Markdown link-reference metadata from search (2026-11-01)

- **Finding:** The shared Markdown prose normalizer removes one-line `[label]: destination` reference definitions but leaves destinations and optional titles when CommonMark wraps them onto indented following lines. Hidden paths and titles can then produce irrelevant search hits and inflate reading time.
- **Change:** Exclude indented continuation destinations (including angle-bracket forms) and separately continued quoted/parenthesized titles. Preserve visible link labels and unindented following prose; keep normal one-line definitions and existing Markdown/HTML rules.
- **Regression:** Four dependency-free cases for multi-line destinations, one-line destinations with next-line titles, angle destinations, and adjacent visible prose. Run through the existing search-plain contract in both Quality and local preflight.
- **Guardrails:** No authored content, browser JavaScript/CSS, game, dependency or budget changes. Require latest PR SHA's complete Quality, clean mergeability, and post-merge main Quality + Pages publish on the exact merge SHA.

## Completed: de-duplicate recent searches across letter case (2026-11-01)

- **Finding:** Recent-search storage compared queries case-sensitively. Searching `Astro` and then `astro` produced duplicate suggestion chips despite the scorer treating them as the same query.
- **Change:** Keep the latest original spelling, but remove older entries that match without regard to letter case; preserve the existing six-item cap, other entries, privacy-mode fallback and filter/URL behavior.
- **Regression:** A narrow-screen Chromium flow seeds mixed-case history, searches via a real result link (the existing persistence trigger), returns to search and checks local storage and rendered chips. No new dependencies, design changes or increased performance caps.
- **Release:** Gate on latest-head complete PR Quality, then verify post-merge main Quality and Pages deploy on the exact merge SHA.

## Completed: exclude Markdown reference destinations and image labels from search prose (2026-11-01)

- **Finding:** The shared search/reading-time plain-text normalizer kept Markdown reference definitions (including URL destinations and optional titles) and image alt text, while treating reference-style link labels and IDs as separate tokens. This could create irrelevant search matches on hidden paths and identifiers.
- **Change:** Drop line-level reference definitions and both inline/reference/shortcut image labels; retain only visible labels of full and collapsed reference-style links. Preserve existing inline link, technical punctuation and fenced-code handling.
- **Regression:** Dependency-free fixtures cover full/collapsed references, image references, shortcut image syntax and indented definitions. No client JavaScript/CSS, dependencies, games, routes, article content or budget changes.
- **Release criteria:** Require newest-head complete PR Quality, then Squash Merge only when clean and all checks pass. Verify post-merge main Quality and Pages Deploy at the exact merge SHA; never override a failing budget or test.

## Completed: de-duplicate search query keywords (2026-11-01)

- **Finding:** The browser currently scores identical query tokens repeatedly, so repeating the same word can unfairly increase its weight. With a six-keyword cap, six copies of one token can also discard a distinct later keyword entirely.
- **Change:** Remove repeated tokens *after* stop-word filtering but *before* the six-keyword cap, retaining the first occurrence's order. Keep the existing scoring weights, query URL, keyboard navigation and result-type filters.
- **Regression:** Use Chromium with a two-record HTTP 200 search-index fixture. Query six repetitions of Astro followed by CSS; verify the article matching both unique terms outranks the Astro-only article without runtime errors or fallback.
- **Guardrails:** No new dependency or budget increase; require full PR Quality (including browser and gzip checks), Squash Merge, and matching post-merge main Quality + Pages SHA.

## Completed: retain underscores inside technical search terms (2026-11-01)

- **Finding:** The shared Markdown prose normalizer removes every underscore, so article-body terms such as `user_id`, `get_user_name` and `api_v2` become separate words. Literal searches for the original code identifiers then miss body-only matches.
- **Change:** Preserve underscore runs between Unicode letters/digits while still removing underscores used solely as Markdown emphasis delimiters. Keep other punctuation, code-fence and HTML rules unchanged.
- **Regression:** Add dependency-free cases for English/Chinese identifiers, multiple underscores, digit suffixes, emphasis and formatted link labels to the existing search-plain contract in full Quality and Preflight.
- **Guardrails:** Only server-side prose normalization, tests and roadmap change; no browser JS/CSS, dependencies, authored articles, games or relaxed gzip limits. Merge only with complete PR Quality green; confirm post-merge main Quality and Pages on the same SHA.

## Completed: ignore embedded HTML code blocks in search (2026-11-01)

- **Finding:** The shared prose normalizer strips `<pre>`, `<script>` and `<style>` markup but leaves their bodies searchable, causing hidden code and CSS/JS to create false search hits and inflate reading-time estimates.
- **Change:** Remove complete HTML preformatted/code, script and style blocks before the generic HTML-tag cleaner. Keep inline `<code>` text searchable and preserve the existing Markdown fenced-code and generic-type behavior.
- **Regression:** Extend the existing Node fixtures for HTML pre blocks (multiline, attributes, case-insensitive), embedded script/style, and retained inline code. Verify reading-time ignores a long HTML code sample.
- **Guardrails:** Server-side normalizer, tests and roadmap only; no browser JS/CSS, new dependencies or relaxed budgets. Require the full PR Quality, clean mergeability, and matching post-merge Quality + Pages SHA.

## Completed: preserve generic type syntax in technical search (2026-11-01)

- **Finding:** Markdown-to-search treats angle-bracket spans beginning with letters as HTML, even in TypeScript/C++ generic expressions (Map<string, number>, Array<Result<T>>, std::vector<int>). The full-text search index loses these technical terms.
- **Change:** preserve angle-bracket arguments attached to preceding identifiers, including nested and Unicode examples, while retaining normal standalone HTML, comment and declaration removal.
- **Regression:** dependency-free Node fixtures cover nested/multi-argument generics, non-ASCII names, actual HTML tags and attributes, alongside existing comparison, code-fence and link checks. Already wired into PR/main Quality and local preflight.
- **Scope:** server-side normalizer, regression and roadmap only. No new dependencies, browser JS/CSS, authored content, games or budget changes. Require latest PR Quality green and same-merge-SHA main Quality and Pages deployment.

## Completed: recover malformed HTTP 200 search indexes (2026-11-01)

- **Finding:** the search client checks only that `posts` is an array before accepting an HTTP 200 payload. A partially corrupted entry (for example, `title: null` or non-array `tags`) can crash result scoring, leaving search unusable even though static article cards are already in the page.
- **Change:** reject incomplete entry metadata before assigning the downloaded array; use the existing static article fallback and visible warning instead of rendering broken records. The build-time index schema gate remains unchanged and serves a different purpose.
- **Regression:** use Chromium request interception to serve malformed HTTP 200 JSON; assert the warning, preserved static article results, disabled unavailable result-type filters, and no page exceptions. Keep the existing HTTP 503/multiword-tag fallback regression.
- **Budget:** reduce duplicate layout scroll-state checks using native idempotent `toggleAttribute` and `classList.toggle(force)`, preserving the scrolled header style through an attribute-presence selector. Browser JS gzip is unchanged as a hard 12 KiB cap; no new dependencies.
- **Release gate:** require unchanged CSS/JS gzip caps, full PR Quality, mergeability, and post-merge main Quality + Pages on the exact merge SHA. If gzip exceeds 12 KiB, do not merge.

## Completed: consolidate article permalink copy interactions (2026-11-01)

- **Finding:** Heading and paragraph permalink widgets independently construct the same anchor element and register near-identical click, clipboard, success-feedback and live-announcement handlers. This duplicates browser JavaScript while the total gzip budget is nearly exhausted.
- **Change:** Share the anchor construction and copy interaction, keep heading/per-paragraph URL and quote semantics, accessible labels, clipboard fallback, and click-without-jump behavior. A failed heading copy now announces the failure just like the paragraph action.
- **Regression:** Exercise both widget types in the Chromium keyboard suite, including no unwanted hash navigation and paragraph accessible naming, plus existing full Quality and JavaScript gzip budgets. No CSS, authored content, game, route, dependency or budget changes.
- **Release:** Only merge the exact tested PR head if complete Quality is green and mergeability is clean; validate main Quality and Pages on the merge SHA. Malformed HTTP 200 search-index recovery remains separate until measured JavaScript headroom exists.

## Completed: retain comparison operators in technical search (2026-11-01)

- **Finding:** The prose normalizer treats any text between angle brackets as HTML, so a sentence such as x < 10 && y > 5 loses its numeric condition. It also strips every greater-than sign as if it were a Markdown quote. These are meaningful terms in technical tutorials and the shared reading-time prose.
- **Change:** Remove actual tags/comments/declarations rather than arbitrary angle-delimited text; strip Markdown blockquote prefixes at line starts while retaining inline comparison operators. Preserve fenced-code, heading, link and existing formatting cleanup.
- **Regression:** Add dependency-free Node assertions for comparisons, nested blockquotes, real HTML tags/comments and mixed quote/comparison lines. Run in existing search-plain contract in full PR/main Quality and local Preflight.
- **Guardrails:** Server-side helper, tests and roadmap only; no browser JS, CSS, games, dependencies, authored content or budget changes. HTTP 200 malformed index runtime fallback remains separate until JavaScript headroom exists.

## Completed: preserve technical hash signs in Markdown search (2026-10-31)

- **Finding:** The Markdown-to-search normalizer strips every `#`, not just heading syntax. A body mentioning `C#`, `F#` or `#Astro` becomes `C`, `F` or `Astro`; searches for the original technical terms can miss results. The same prose normalizer also feeds article reading-time estimates.
- **Change:** Remove only CommonMark ATX heading prefixes (one to six hashes separated from text by whitespace) and optional closing markers on those heading lines. Preserve literal hashes inside technology names, hashtags and hash-prefixed text that is not a Markdown heading.
- **Regression:** Expand the existing dependency-free search-plain test with language names, literal hash words, ordinary and trailing-marked headings, no-space prefixes and empty headings. The contract already runs in GitHub Quality and local Preflight.
- **Guardrails:** Server-side text normalization and regression only: no browser JavaScript, CSS, new dependencies, authored content or game changes and no budget increase. The separate malformed HTTP 200 recovery attempt (#71) was **not merged** because total JS gzip exceeded 12 KiB; that still requires measurable headroom before another attempt.

## Completed: exclude fenced code from article reading estimates (2026-10-31)

- **Finding:** The shared article reading-time helper only removes paired triple-backtick snippets. Long backtick fences, tilde fences and unclosed code blocks remain in the character count, so code-heavy tutorials can show inflated estimated reading minutes on article cards and search results.
- **Change:** Reuse the already-tested, server-side Markdown prose normalizer in a small reading-time helper; keep the existing minimum of one minute and 400-character rounding. Export the helper through the existing site.ts API so all current surfaces and the search index agree.
- **Regression:** Add Node fixtures for long prose, ordinary/long/tilde/unclosed fences and line-start inline code. After building, compare all article estimates in the emitted search index with pre-rendered search cards. Run in GitHub Quality and local Preflight.
- **Guardrails:** No browser-side JS/CSS, new dependencies, route or authored-content changes, games or increased budgets. Merge only on fully passing latest PR Quality, then validate main Quality and Pages at the same merge SHA.

## Completed: retain prose after inline Markdown code at line start (2026-10-31)

- **Finding:** The search text helper mistakes a line-start inline backtick span such as `\`\`\`inline\`\`\`` for a fenced code opener, then drops all subsequent paragraphs if no closing fence appears. CommonMark disallows backticks in a backtick fence's info string, so this is inline code, not a fence.
- **Change:** Reject invalid backtick fence openers containing backticks after the opening delimiter while retaining tilde fence info strings and the existing stripping of actual code fences.
- **Regression:** Extend the shared dependency-free search-plain contract with triple and longer inline spans at line start plus valid tilde fences; run in both GitHub Quality and preflight.
- **Guardrails:** Server-side search helper, regression assertions and roadmap only; no client JS/CSS, authored content, games, dependencies or budget increases. Exact-head Quality must pass before Squash Merge and same-SHA main Quality/Pages must pass afterward.

## Completed: validate emitted search records before release (2026-10-31)

- **Finding:** The previous malformed HTTP 200 index fallback attempt (PR #65) failed the strict 12 KiB browser JavaScript gzip limit and was deliberately not merged. The build previously had no mandatory shape check for its own emitted records. A missing title or non-string tag in generated metadata could therefore ship and break the browser scorer.
- **Change:** Validate the server-generated entries before JSON serialization, including string fields, tag array members, finite nonnegative reading minutes and unique paths. Fail the build rather than publish an invalid index. This does **not** claim to handle third-party/corrupted HTTP 200 responses at runtime; that remains separately scoped.
- **Regression:** Add invalid fixture contracts and check the actual emitted search-index.json after every build. Run in both GitHub Quality and local Preflight, before gzip and browser checks.
- **Guardrails:** No browser JavaScript or CSS, dependencies, content, games, route changes or size-cap increases. Exact-head PR Quality must be green before Squash Merge; require same-SHA main Quality and Pages deployment afterward.

## Completed: exclude Markdown fenced code from full-text indexing (2026-10-31)

- **Finding:** The search text helper removes paired triple-backtick spans but does not recognize `~~~` fences, longer backtick fences or an unclosed code block. This can index private-looking sample code as prose and return misleading full-text matches.
- **Change:** Parse Markdown fence lines before existing prose cleanup. Support tilde/backtick markers, up-to-three-space indentation, longer closing markers, CRLF, mismatched closers and unclosed fences while preserving meaningful hyphens and inline behavior.
- **Regression:** Extend the existing dependency-free search-plain contract with real fenced-code fixtures; it already runs in both GitHub Quality and local preflight.
- **Release scope:** Search index server helper, test and roadmap only. No dependencies, authored content, runtime browser JavaScript/CSS, games or size-cap changes. Merge only after complete exact-head PR Quality; verify the subsequent main Quality and Pages deploy at the merge SHA.

## Completed: keep meaningful hyphens in full-text search (2026-10-31)

- **Finding:** The Markdown-to-index text normalizer strips every hyphen alongside Markdown punctuation. Full-text queries such as `CSS-in-JS`, `foo-bar` and `Vue-3` therefore fail to match those exact body terms, even though the prose contains them.
- **Change:** Extract the existing index-only normalization into a shared server helper. Keep hyphens that belong to content, while explicitly removing Markdown list bullets and horizontal rules. Preserve code fence, image, link, HTML and decoration exclusions.
- **Regression:** A dependency-free Node contract exercises hyphenated Chinese/English and technical terms, list bullets, horizontal rules, links and fenced code. Run in both Quality and local preflight.
- **Scope and gates:** No browser JavaScript/CSS, dependency, authored-content, game or size-cap changes. Only merge after full latest-head Quality succeeds (including size, browser/a11y and games), then verify main Quality and Pages Build/Deploy on the same SHA.

## Completed: preserve multiword tags when search index fails (2026-10-31)

- **Finding:** Static search cards serialize tags as a space-separated `data-tags` string. If a label contains whitespace (for example `React Native`), degraded search splits it into separate fake tags when `search-index.json` is unavailable, so the displayed chips no longer agree with the tag directory or healthy search.
- **Change:** Store the complete distinct-label array in the HTML data attribute as JSON and parse it when building degraded article-only search results. Preserve label boundaries, order, all tag matches, existing index behavior and source metadata.
- **Regression:** Extend the built search-tag contract to compare the HTML data array with each published article index entry, and add a real Chromium outage test with a synthetic two-word label and a failed index response. Both CI Quality and local preflight already run the relevant tests.
- **Guardrails:** No dependencies, authored content, games or changed performance budget. Allow merge only after full Quality passes on the exact PR head and mergeability is clean; verify main Quality and Pages on the resulting SHA.

## Completed: keep search tag labels distinct across index and cards (2026-10-31)

- **Finding:** The content schema allows duplicate labels. Although tag pages and related-reading ranking have been corrected, search still emits raw repeated tags into the JSON index and the initial HTML. A result such as `['CSS', 'CSS', 'Astro', 'React']` shows `#CSS` twice and hides `#React` in the three-tag preview.
- **Change:** Deduplicate each post/note tag list in first-seen order for the search index; apply the same rule to the pre-rendered search fallback cards. Keep exact label spelling, all unique tags available for search scoring, original content arrays and existing routes unchanged. The hydrated results already read index metadata, so no client-side script change is needed.
- **Regression:** Pure Node fixtures exercise repeated and case-distinct labels, the three-tag display cap and non-mutation. Post-build checks ensure every indexed entry is unique and pre-rendered post cards match the corresponding index tags. Add the check to PR/main Quality and local preflight.
- **Guardrails:** no dependency or content changes, no browser JS/CSS or games, no increased size budgets. Merge only after complete green Quality for the latest head SHA; then verify main Quality and Pages publish that exact merge SHA.

## Completed: keep search note previews consistent with note excerpts (2026-10-31)

- **Finding:** Note titles come from their first sentence, but the published `search-index.json` still uses the first 120 characters of the same text as its note description. In the search page's empty-query note filter, the title and preview repeat the opening instead of showing what follows. The note-list/preview helper already solves this for normal and long leading sentences.
- **Change:** Reuse `noteExcerpt(note, 120)` for search-index descriptions. Keep the existing first-120-characters fallback for single-sentence notes so the result card does not become blank. Leave the searchable full text and all post metadata intact.
- **Regression:** Assert punctuation, long (>120 character) first sentences, no-punctuation and single-sentence behavior in a dependency-free Node test. Check every built note entry's title/description against the same text semantics so changing the generator cannot silently undo the fix; run after build in PR/main Quality and local preflight.
- **Guardrails:** no new dependencies, content edits, routes, browser JS/CSS, game changes or budget increases. Require complete Quality success on the exact PR head before squash merge; validate main Quality and Pages deploy the same resulting SHA.

## Completed: deduplicate tag relevance in related reading (2026-10-31)

- **Finding:** The post recommendations under “接着读” score overlapping tags by filtering the candidate's raw metadata. Repeating a tag in that array inflates its score and can display duplicate reasons such as `#CSS #CSS`; the schema currently permits duplicates. This is distinct from the tag-directory and series-overview fixes.
- **Change:** Count each shared label once, preserving candidate tag order for the two-tag visible explanation and retaining category points, publication-date tiebreaks, series-first recommendations, URLs and existing budgets.
- **Regression:** Add direct distinct-tag relevance contracts inside the existing related-reading test, which already runs in both CI Quality and local preflight after build. Cover single-label repeats, true multi-label overlap, ordering, scores, explanation cap and input non-mutation.
- **Release:** Isolated branch from successful main. No dependencies, article content, client JavaScript, CSS, games or budget changes. Merge only after full Quality passes for the exact PR head and the PR is mergeable; then verify main Quality and Pages on the same merged SHA.

## Completed: count series tags by distinct articles (2026-10-31)

- **Finding:** A single article may repeat its tag label (the content schema permits it). The series overview counts each occurrence, so one article tagging itself `CSS` twice can falsely make `#CSS` appear as a shared series topic even when no other article uses it. This is separate from the tag-directory fix in PR #59.
- **Change:** Count each label at most once per article when selecting the up-to-four tags that appear in multiple series articles. Preserve frequency ranking and first-encounter tie order, original metadata, series reading sequence and URL structure.
- **Regression:** Add a dependency-free Node contract for single-article repeats, real shared labels, ordering, four-tag cap, empty series and non-mutation; run it before build in both CI and local preflight.
- **Release:** Keep dependency versions, runtime JS/CSS, games, content and budgets unchanged. Validate the exact PR head in full Quality before squash, then require main Quality and same-SHA Pages success.

## Completed: avoid duplicate entries in tag buckets (2026-10-31)

- **Finding:** The content schema accepts repeated tag labels in a single post or note. `collectTags()` appends that entry once for every occurrence. Tag pages then render the same card repeatedly, and totals and popularity rankings are inflated.
- **Change:** Deduplicate each entry's tag labels while aggregating, without changing the authored tag arrays. Preserve distinct posts/notes sharing a tag, chronological ordering, the existing tag routes, and ranking.
- **Regression:** Add a deterministic Node 22 contract with duplicate post and note labels, unique entry counts, ordering, non-mutation, and empty-content cases. Run it before the build in both CI Quality and local preflight.
- **Release:** No dependencies, runtime JavaScript, CSS, game, content, route, or budget changes. Use an isolated branch; require exact-head full Quality and clean mergeability before squash. Verify main Quality and same-SHA Pages deployment.

## Completed: avoid duplicate long-note openings in excerpts (2026-10-31)

- **Finding:** Note titles truncate after 40 characters, but the preview helper only recognizes a sentence ending within the first 120 characters. A note whose first sentence is longer than 120 characters previews its opening from the start, repeating the visible title instead of describing what follows.
- **Change:** Extract the note excerpt boundary logic into the pure text helper, then skip the entire first sentence when it has a sentence-ending mark, no matter how long it is. Keep punctuation-free notes, the 90-character preview limit, title rules and existing routes unchanged.
- **Regression:** Add a deterministic Node 22 fixture for normal, 120+ character, punctuation-free and single-sentence notes, as well as length limits. Run it in both local preflight and Quality; retain all content, Astro type/build, accessibility, keyboard, games, CSS/JS size and first-visit budgets.
- **Release:** Isolated branch based on successful main; merge only on fully successful latest-head PR Quality with a clean merge state. Verify resulting main Quality and Pages deployment on the same SHA.

## Completed: search shortcut must close active mobile dialogs (2026-10-31)

- **Finding:** Ctrl/⌘+K and / are documented to focus search on the search page, but the global handler tries to focus the search input while a modal navigation or shortcut-help dialog is still open. The browser's modal top layer keeps focus inside the dialog, so the shortcut does not take the user to search.
- **Change:** When the target search input exists, close active dialogs before focusing and selecting the input. Preserve normal navigation to search from other routes, URL state, and standard dialog close events/aria-expanded updates.
- **Regression:** In real 390px Chromium, open mobile navigation on the search route, use Ctrl+K, and check the drawer closes, aria-expanded resets, and input gains focus. Repeat with / from keyboard shortcut help launched through reading settings. Keep full build, size, a11y, games and deployment gates.
- **Release:** Separate branch from verified main. Squash only after exact-head PR Quality succeeds and mergeability is clean; then verify main Quality and Pages on the resulting SHA.

## Completed: avoid stacked modal dialogs from the mobile keyboard shortcut (2026-10-31)

- **Finding:** Pressing `?` while the mobile navigation dialog is open launches the shortcut-help dialog without closing navigation. Both modal dialogs remain open in the top layer, forcing two Esc presses and leaving menu state visually confusing.
- **Change:** Close any open navigation/settings dialog before showing shortcut help. Preserve shortcut activation from normal pages and the existing menu and settings controls. The revised handler is no larger than the previous code.
- **Regression:** In real 390px Chromium, open the navigation drawer then press `?`; require only the shortcut dialog to be open and focused, menu `aria-expanded` to reset, and one Esc to close the sole remaining dialog. Continue all existing build, browser, keyboard, axe, games, budget and deploy gates.
- **Release:** Separate branch. Only squash-merge after the latest PR Quality succeeds, then confirm main Quality and Pages deploy on the resulting SHA.

## Completed: block stale Enter navigation while search index loads (2026-10-31)

- **Finding:** Before the search index is ready, the page still displays its server-rendered all-article fallback list. Inputting a new keyword updates the field but cannot filter the list yet. Pressing Enter immediately opens the first *unfiltered* article, even when it has nothing to do with the keyword.
- **Change:** Allow Enter to navigate to a result only after the index has resolved (including the existing degraded fallback). Preserve ordinary clicks on pre-rendered links and normal Enter navigation once the search results are ready.
- **Regression:** Intercept the search-index request in Chromium, type a pending keyword, press Enter, and verify the user remains on the search page. Release the request and verify that the query, shareable URL, results and history are still correct. Keep all budget, accessibility, game and deploy gates unchanged.
- **Release:** Implement on an isolated branch, merge only after the exact latest PR SHA passes full Quality with no conflicts, then verify successful main Quality and same-SHA Pages build/deploy.

## Completed: share searches typed before the index loads (2026-10-31)

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

## Completed: malformed HTTP 200 search-index metadata fallback (2026-11-01)

- **Finding:** the client's HTTP 200 index validation covered scorer fields (title, description, category, text and tags), but did not validate render metadata: href, date and minutes. A syntactically valid JSON response with a poisoned/missing href or invalid minutes could silently render broken/unsafe links and labels instead of using the static article fallback.
- **Change:** require nonempty title/date, a site-base-relative href and finite nonnegative minutes before accepting an index response. Continue to show the existing degraded-search notice, restrict to articles and restore the server-rendered cards when any record is malformed. Preserve the original search scoring, type selection, history and URLs in a valid index.
- **Regression:** Chromium intercepts HTTP 200 with an unsafe href, absent date and nonnumeric minutes; every case must show the visible fallback, keep real static article hrefs and avoid page errors. Existing valid-index ranking fixture now uses the same base-relative href format emitted by the real build.
- **Guardrails:** no dependency, game, stylesheet or content changes. Keep JavaScript gzip ≤ 12,288 bytes; require full latest-head PR Quality success, then merged main Quality and same-SHA Pages success. Do not merge on a failing budget.

## Completed: mobile dialog test readiness and bounded diagnostics (2026-11-01)

- **Finding:** After PR #79 was merged, main Quality attempt 1 timed out at `scripts/a11y-keyboard.mjs:865` waiting for `#settings-panel[open]` in the 320/390px touch test. The same SHA passed on rerun. That fixture navigated with `waitUntil: 'load'` and clicked the settings toggle immediately, without waiting for the shared client shell to finish binding handlers. This is a plausible race, not a proven production defect.
- **Change:** Wait for the existing `data-booted="on"` readiness signal before testing genuine mobile pointer interactions; retain physical touch/click checks. Bound the dialog-open waits to 5 seconds so future failures surface quickly rather than consuming the default 30 seconds.
- **Regression:** Keep the entire Chromium keyboard, mobile touch and accessibility Quality suite mandatory. Verify the final PR SHA, merged main Quality and Pages deployment SHA; a green run reduces but cannot eliminate intermittent-failure uncertainty.
- **Guardrails:** test/docs only; no product JS/CSS, games, article content, dependencies, URLs or performance-budget changes.

## Completed: bounded search scoring allocations and browser JS cleanup (2026-11-01)

- **Finding:** search scoring used an unlimited `body.split(term)` for each keyword on each input change, although ranking only needs the first 12 occurrences. The base layout also checked for prose images before calling a lightbox function that independently queries and guards images, and reading-setting updates recreated the full settings object on every click.
- **Change:** cap split output at 13 segments without altering the 12-hit score ceiling; call the lightbox's own guarded initializer once rather than scanning the DOM twice; update only the selected setting property. Expose exact JS/CSS gzip bytes and remaining headroom in the build budget logs (the hard limits remain unchanged).
- **Regression:** verify capped-count parity for empty, repeated and long-content samples, then require the existing entire search/browser, lightbox, settings, content, build, axe, keyboard, game, font and transfer-budget suites in PR Quality. Merge only when the latest PR commit is green; require main Quality followed by same-SHA Pages deployment.
- **Guardrails:** no dependency, route, content, game, theme appearance or CSS changes; do not increase either size limit.

## Completed: share search CSS rules and reuse the current search URL (2026-11-01)

- **Finding:** On the previous green build, JS gzip had only 8 bytes and CSS gzip 18 bytes of headroom. The search page parsed the same URL twice during one input change. The search-arrow and suggestion-tag hover rules repeated the same border/color declarations; the bounded search scorer retained a redundant Math.min after limiting split results.
- **Change:** Reuse one URL object inside `apply()` for selecting filters and synchronizing the query. Consolidate the identical search-arrow and suggestion-tag hover colors/borders while preserving other cascade-sensitive rules. Remove redundant Math.min in bounded keyword counting.
- **Regression:** Require existing search/history/Back-Forward/browser/axe/keyboard and exact JS/CSS asset-budget checks. Compare with the previous 12,280 / 21,486-byte baseline.
- **Guardrails:** No dependencies, URLs, ranking, games, content, budget increases or layout redesign.

## Completed: conservative CSS cascade consolidation (2026-11-01)

- **Baseline:** main CSS gzip 21,486 / 21,504 bytes (18 bytes free), JS gzip 12,279 / 12,288 bytes (9 bytes free).
- **Scope:** consolidate byte-for-byte equivalent declarations for desktop header nav, mobile bar hover, search history/suggestion flex layouts, responsive game cards/notes, series link states, and narrow-screen sidebar/reader-list columns. Keep selector specificity and media breakpoint scope unchanged; avoid any game logic, runtime JS, content or dependency changes.
- **Measured result:** CSS gzip 21,483 / 21,504 bytes (21 bytes free) and JS remains 12,279 / 12,288 bytes (9 bytes free). This is only a **3-byte CSS gzip reduction**, **not** a resolution of the overall performance-budget pressure. The original source declarations were shortened, but gzip already compresses repeated CSS effectively.
- **Required gate:** latest PR-head Quality must pass the existing build, full browser interactions, axe, keyboard, game smoke, wire and fixed-budget checks. Then squash-merge and validate main Quality followed by Pages on the exact merge SHA. Public HTTP remains a distinct verification gate.
- **Next investigation:** prioritize measured removal of genuinely unused CSS or structural payload reduction instead of repeated micro-deduplication; preserve visuals and controls with browser regressions.

## Completed: enforce real calendar dates in the search index (2026-11-01)

- **Audit finding:** the existing YYYY.MM.DD regex enforced the shape and day range 01–31, but still accepted nonexistent dates such as 2026.02.29 and 2026.04.31. These metadata strings then entered published search results.
- **Change:** check actual Gregorian month lengths and leap-year rules (including 100/400-year boundaries), for both publication and update dates. Preserve the existing output format and valid dates.
- **Regression:** accept February 29 in 2000 and 2024; reject impossible dates in leap and common years, non-leap centuries, and year zero. Require full PR Quality followed by same-SHA merged-main Quality and Pages deployment.
- **Scope:** build-time contract and tests only. Do not touch client JavaScript/CSS, games, dependencies, or raise size budgets; substantial compressed-asset headroom remains a separate open task.

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
