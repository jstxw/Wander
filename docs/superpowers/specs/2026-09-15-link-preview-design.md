# Link preview dropdown

Approved 2026-09-15.

## Goal

When a learner hovers or focuses a link, or when Wander highlights a link, show a small dropdown that explains where the link leads. A quick preview appears for free; a plain-language AI summary appears only when the learner asks for it.

## Decisions

| Question | Decision |
|---|---|
| When it appears | On the link Wander highlights, and on any link hovered or focused while the Wander panel is open |
| How much it knows | Quick preview (title, site, description) first; **Tell me more** requests an AI summary |
| Where the page is read | The local Wander server fetches it logged out, with public-address checks |

## Experience

- Hover (or Tab-focus) a link for 500 ms while the panel is open → dropdown under the link: page title, site name, one or two lines of description, **Tell me more**.
- The "Your turn" guidance card shows the same preview automatically when its target is a link.
- **Tell me more** → 3–4 plain sentences: what the page is for, what you can do there, anything to watch for (sign-in required, payment). One Luna call that counts toward the $1.80 total limit.
- Dismiss: pointer leaves the link and dropdown (grace period lets the pointer move into the dropdown), Escape, or a click elsewhere.
- Skipped: same-page `#` anchors, non-HTTP links (`mailto:`, `javascript:`, `tel:`), Wander's own UI, and any hover while the panel is closed (the highlighted link still previews).

## Components

- `server/link-preview.mjs`
  - `previewLink(url, options)` — safe fetch plus extraction: `{ url, finalUrl, site, title, description, heading, text }`. In-memory cache, 10 minutes, keyed by URL.
  - `explainLink(preview, { key, budget, fetcher })` — one Luna call with a strict JSON schema `{ summary }`, using `Budget.reserve`/`settle`.
- `server/index.mjs` — `POST /api/local/preview` `{ url }` and `POST /api/local/explain` `{ url }`, handled beside `speech`, independent of any running task.
- `extension/background.js` — `WANDER_PREVIEW` and `WANDER_EXPLAIN` messages forwarded to the server with the pairing token.
- `extension/link-preview.js` — content script: hover/focus detection, 500 ms delay, per-page cache, dropdown in a closed shadow root.
- `extension/guidance.js` — the guidance card requests and shows a preview when the target element is a link.

## Safety

- Only `http:`/`https:` URLs without embedded credentials.
- DNS results are validated at connection time; loopback, private, link-local, CGNAT, multicast and reserved IPv4/IPv6 ranges are refused.
- At most 3 redirects, each re-validated. 5 s timeout, 1.5 MB body cap, `text/html` only, no cookies, custom User-Agent.
- Page text is marked untrusted in the model prompt; the model never receives the learner's own page or credentials.
- Tests can inject the address check so a local fixture server is reachable.

## Failure handling

If the fetch is refused, fails, times out, or is not HTML, the dropdown shows the link text and host with "Couldn't open this page for a preview", and **Tell me more** is disabled.

## Testing

- Server: local fixture HTTP server for extraction, redirect to a private address refused, size cap, non-HTML refused, caching; `explainLink` with a stub fetcher and temporary budget ledger.
- Extension: Playwright fixture page with stubbed `chrome` messaging for hover delay, dismissal, **Tell me more**, and the guidance card preview for link targets.
