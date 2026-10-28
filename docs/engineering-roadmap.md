# Engineering roadmap

_Last reviewed: 2026-10-28. Scope: `cui-and-jing/blog`._

## Baseline and constraints

- Astro 7 + Markdown/MDX, deployed to GitHub Pages.
- Existing products: articles, notes, search, local reading list, reading progress, Bean Rush and Pixel Raid.
- On the previous main build, CSS was about 107.9 / 108 KiB (gzip 20.9 / 21 KiB); JavaScript gzip was close to 12 / 12 KiB.
- Quality gates cover content, font subsets, types, build, size, per-page fonts, both games, axe, keyboard, and first-visit network transfer.
- A deploy can succeed while a separate main-branch Quality run fails. Both must be checked after merging.

## Priorities

| Order | Workstream | Acceptance criteria |
| --- | --- | --- |
| P0 | Restore reliable main-branch Quality | TOC keyboard navigation and `aria-expanded` stay consistent; no post-merge red checks. |
| P1 | Reclaim CSS and JavaScript headroom | Remove genuinely duplicated rules and event logic; retain the existing caps, visual behavior, and browser tests. |
| P2 | Stabilize browser regression tests | Test keyboard, pointer, URL history, narrow screens, reduced motion, and failures; wait for the final observable state instead of a transient event. |
| P3 | Modularize optional UI code | Audit the large layout script. Split or defer optional features only when total built size and first-visit transfer do not regress. |
| P4 | Improve content discovery | Consider navigation feedback and reading-list/search improvements after P0-P3, measured against small-screen usability. |
| Separate | Game playability | Keep Bean Rush / Pixel Raid work in focused PRs with real game smoke and deterministic combat tests. |

## Merge checklist for every iteration

1. Branch from current `main`; avoid unreviewed dependency upgrades.
2. Keep URLs, existing articles, both games and local data backwards-compatible unless a change is explicitly scoped.
3. Add regression coverage for the behavior changed.
4. Require the **latest PR head SHA** to pass all Quality checks and to be mergeable.
5. Squash-merge, verify the resulting commit SHA, then verify both GitHub Pages deployment **and main-branch Quality** on that SHA.
6. Record any failed or deferred work honestly; never raise a budget solely to get a green CI.

## Deferred decisions

- Dependabot PRs (including TypeScript 7) need compatibility testing in separate branches; no automatic merge.
- Do not add a new game or large animated homepage feature until runtime and CSS headroom have been recovered.
