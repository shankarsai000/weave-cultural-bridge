# WEAVE

WEAVE finds cultural anchors that several organizer-defined audience profiles share, using Qloo recommendations. It then compiles them into a timed, budget-checked event run-of-show with the evidence attached.

**Status:** full stack, tested offline. Live Qloo calls go through the official harness but have not been checked against your event credential. See "Verification".

## Run it

    npm test                 # 17 tests: core, API, live path (test double), UI
    npm run build:web        # rebuilds public/index.html
    npm start                # http://localhost:3000, demo mode

Requires Node 22.19 or newer. No runtime dependencies.

## Live Qloo

    npm install --global @qloo/qloo-harness@0.1.26
    qloo setup --qloo        # or export QLOO_API_KEY on the server
    npm start

Open the page and switch to **Live**. Search for each profile's references, confirm 2 to 5 seeds, then press **Run live analysis**. A live analysis spends event quota, so it runs only when you press the button.

Calls go through `qloo api search` and `qloo api insights` with `--json`. The harness reads the key. This code never passes the key as an argument, logs it, or sends it to the browser.

## Docker

    npm run build:web
    docker build -t weave .
    docker run -p 3000:3000 -e QLOO_API_KEY=your-event-key weave

## API

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | Status and default mode. Never returns the key. |
| GET | /api/entities/search?q=&mode=demo\|live | Entity search for seed confirmation |
| POST | /api/analysis | Per-profile exploration, bridge scoring and evidence. Body: mode, brief, communities (2 to 4 profiles, 2 to 5 seeds each), targetEntityType |
| POST | /api/plans | Compile selected candidates into a run-of-show and validate it |
| PATCH | /api/plans/:id | Edit durations, costs or brief limits, or request a repair. Re-validates. |
| POST | /api/export | Export a plan as json, md or csv. Provenance comes from the stored analysis, not the client. |
| POST | /api/feedback | Accepts useful or not useful. Not stored in this build. |

Errors share one envelope: `{ "error": { "code", "message", "requestId", "retryable" } }`. Analyses are limited to 30 per minute per client (`WEAVE_ANALYSES_PER_MINUTE`).

## Provenance and claims

- `demo-fixture`: synthetic entities in `src/fixtures.js`, ranked by shared tags. They stand in for Qloo and are labelled everywhere, including exports.
- `qloo-live`: entities returned by the harness in live mode.
- `bridgeScore = 0.70 × coverage + 0.30 × rankQualityMean` is WEAVE's triage score. It is not a Qloo score, a probability, or an attendance prediction.
- Costs are placeholders labelled as assumptions until an organizer replaces them.

## Layout

    src/core.js        validation, normalization, scoring, portfolio, planning, validation, repair
    src/exporters.js   JSON, Markdown and CSV (shared by server and browser)
    src/harness.js     live adapter for the official harness (qloo api)
    src/fixtures.js    labelled demo data and a demo adapter
    src/server.js      HTTP API and static page
    web/               UI source. scripts/build-web.js bundles it into public/index.html
    test/              core, API, live-path (test double) and UI tests

## Changes from the build guide

- Transport: the official harness (`qloo api`), the event's listed surface. Direct REST is not used.
- Language and framework: plain JavaScript with runtime checks, not TypeScript, Zod or Next.js. The core runs unchanged in Node and in the browser. Moving to Next.js is a later option.
- Added beyond the guide: a per-segment length rule, repair suggestions, placeholder-ID rejection in live mode, seed provenance checks, candidate exclusion, call counts, a per-client analysis limit, and one log line per request.

## Verification

- 17 tests pass offline. The live path runs against a test double that prints the envelopes the harness is expected to return. Those are not real Qloo responses.
- The UI test runs the real bundle against a stub DOM. It has not been run in a real browser.
- The Docker image has not been built in this environment.
- The envelope shapes come from the harness source. Check one real response against a sanitized fixture (the documentation pack's VALIDATION_TEMPLATE.md) before relying on them.

## Not finished

- LLM brief parser and segment drafter (optional in the guide).
- Saved projects. Analyses and plans live in memory and reset on restart.
- Browser end-to-end tests (Playwright).
- Public deployment and the Gate A live check. Both need your hosting and your event credential.
- Owner and role placeholders per segment, and the discovery segment type.

## License

MIT (see LICENSE). Change it if your event rules require something else.
