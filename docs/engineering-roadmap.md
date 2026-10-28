# Engineering roadmap

_Last reviewed: 2026-10-28. Scope: `cui-and-jing/blog`._

## Baseline and constraints

- Astro 7 + Markdown/MDX, deployed to GitHub Pages.
- Existing products: articles, notes, search, local reading list, reading progress, Bean Rush and Pixel Raid.
- On the previous main build, CSS was about 107.9 / 108 KiB (gzip 20.9 / 21 KiB); JavaScript gzip was close to 12 / 12 KiB.
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
