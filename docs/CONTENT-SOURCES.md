# Today content sources and shared vocabulary

## Daily reader choice

Web and iOS use `/api/news/recent?date=YYYY-MM-DD`. Three fixed slots are returned: Local/Regional, Global Science & Discovery, and Culture, Sports & Human Interest. A reader can open any or all; selecting a story does not itself earn reflection credit. Drafts are separate per article for the current account/day and are not durable across app/browser restarts.

The registry uses Science News Explores, DOGO News (science/sports/fun feeds), First News Live, Bangkok Post Learning, and youth/technology-filtered Eco-Business news. Regional classification requires geographic evidence in the headline/preview, not merely a regional publisher. Classification is heuristic, not a human editorial or reading-level review.

Only dated, trusted HTTPS items within the existing 14-day freshness ceiling qualify. Daily selection rotates among up to five recent eligible stories per category; it does not promise newly published stories every day or prevent repeats. Empty categories remain explicitly unavailable, never filled with stale or mislabelled stories. Filled editions are stable while the process/cache survives; restart-persistent editions need a future storage change.

The app displays attribution, publication date, a short feed preview (at most 25 words), and a link to the publisher. It does not retrieve full articles or bypass subscriptions. Public feed availability is not evidence of commercial permission.

## Requested publishers still pending

- Smithsonian TweenTribune: a current dedicated feed has not been verified; Smithsonian Magazine is not a substitute.
- CNN10: dedicated feed not verified; no general CNN feed substituted.
- The Week Junior: dedicated feed not verified; First News supplies the requested alternative.
- CNA Explains: dedicated Explains feed/permission unresolved. [CNA RSS terms](https://www.channelnewsasia.com/rss/rssterms) restrict RSS use; the published feed offering is for personal, non-commercial use. Do not activate for a commercial app without suitable permission.
- The Straits Times Mind Stretcher/Youth: dedicated feed and rights not verified; a general youth topic tag is not an educational feed.

Review publisher permissions before commercial release, including active feeds. [Eco-Business feed directory](https://www.eco-business.com/feeds/) and [republishing guidelines](https://www.eco-business.com/about/republishing-guidelines/) are source references, not a blanket license determination.

## Shared vocabulary contract

`/api/enrichment/vocabulary/today?date=YYYY-MM-DD` returns one daily word, the Monday–Sunday seven-word pool, and three original context sentences with answer index and explanations. Both clients use this payload. The current catalog retains the existing 30-word calendar; it is not adaptive or a new claim of SAT readiness. Question difficulty has not been learner-tested.

Saturday/Sunday crosswords use only the seven shared words and their definitions, regardless of articles read. No news-derived or filler clues enter those weekend puzzles. Tuesday/Thursday crossword and Monday/Wednesday/Friday Sudoku scheduling remains unchanged.

## Verification — 2026-09-07

Focused server/client tests cover category selection, freshness and unavailable slots, API access/response contracts, per-article drafts, challenge feedback, and weekend pool parity. A real feed smoke filled all three slots: Bangkok Post Learning (Sep 4), Science News Explores (Sep 3), First News (Aug 26). This verifies availability, not publisher permission or reading-level calibration.

The focused iOS simulator build and XCTest run passed 49 tests (model decoding and daily puzzle/news selection). Web interactions were checked in an isolated fixture at desktop and 390px width. Physical-device/Dynamic Type interaction checks and production release verification remain outstanding. These changes are local, not deployed.
