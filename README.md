# Course tree search

A student types a term, the app sends it to the course tree search service and
shows what comes back as an outline, each child under its parent with one
hyphen per level of depth. The service is the sandbox at
`https://coursetreesearch-service-sandbox.dev.tophat.com`, reached through a
local `/api` proxy.

![The page after searching for "Question 5": the search form, the summary line and the outline](docs/screenshot.png)

## Run it

`.nvmrc` pins Node 22. `engines` in `package.json` accepts
`^20.19.0 || ^22.13.0 || >=24.0.0`, the range jsdom and Vite support, and
the suite was run on Node 22 and 26. There are no runtime dependencies beyond
React and ReactDOM.

```sh
nvm use          # reads .nvmrc
npm install
npm run dev      # http://localhost:5173/, with /api forwarded to the sandbox
npm test         # vitest run, once, no watch
npm run lint     # eslint .
npm run build    # typecheck, then vite build into dist/
npm run preview  # serves dist/ at http://localhost:4173/ with the same /api forwarding
```

`npm run typecheck`, `npm run format` and `npm run format:check` also exist.

Terms to try, with what the sandbox returned on 30 September 2026:

- `a`: 350 items, most of the course.
- `e`: 369 items.
- `Module`: 344 items, every module with its sections and questions.
- `error`: the service answers HTTP 400, and the app says the term was
  rejected and offers no retry.
- `Lab`, the term in the brief's example: an empty array today, so the app
  says no items were returned.

The sandbox also answers 503 or 504 now and then, and holds some responses for
a few seconds. The app shows those as a service problem with a Try again
button, and pressing it resends the same term.

## Sandbox behaviour

Observed on 29th September 2026 against
`https://coursetreesearch-service-sandbox.dev.tophat.com`.

- The path given in the brief, `/treesearch/?query=`, returns 404 with a JSON body,
  with and without the trailing slash. The service root, `/?query=`, returns results.
  The client targets the root; `buildSearchUrl` is the one place to change if the
  path is restored.
- A successful response is a bare JSON array of `{ "id": integer, "name": string,
"parent_id": integer }`, for example `{"id":88,"name":"Question 5.1","parent_id":87}`.
  No wrapper object and no other fields were seen.
- `error` returns HTTP 400 with `{"detail":"Query invalid"}`.
- An `access-control-allow-origin: *` header was present for a localhost origin
  on the 28th and absent on the 30th, so nothing depends on it.
- `o` returned a non-array JSON body once and a normal array minutes later.
- At random the service answers 503 with
  `{"detail":"Failed to search for unknown reason"}` or, after about seven
  seconds, 504 with an HTML "Gateway Time-out" page, and some successful
  responses arrive 1 to 4 seconds late.

The id order, the empty result for `Lab`, the response sizes and the scan for
duplicate ids, missing parents and cycles are under Run it and Decisions and
assumptions.

To reproduce:

```sh
B='https://coursetreesearch-service-sandbox.dev.tophat.com'
curl -s -o /dev/null -w '%{http_code}\n' "$B/treesearch/?query=a"      # 404
curl -s "$B/?query=a" | head -c 200; echo                              # bare array
curl -s -w '\n%{http_code}\n' "$B/?query=error"                        # {"detail":"Query invalid"} 400
curl -s -D - -o /dev/null -H 'Origin: http://localhost:5173' "$B/?query=a" | grep -i access-control || echo 'no CORS header'
```

## Architecture

```
src/
  main.tsx                  mounts the app in StrictMode and loads the stylesheet
  App.tsx                   builds the HTTP client once and lays out the page
  App.test.tsx              drives whole-page journeys, one of them through the real client
  styles.css                colour tokens, dark mode, focus rings, and the outline's indent
  vite-env.d.ts             declares the VITE_API_BASE_URL environment variable
  test/setup.ts             registers matchers, cleans up after each test, and blocks the network
  test/setup.test.ts        checks that the setup did both
  course-search/
    types.ts                the item, node, issue and error-code types everything below shares
    client.ts               builds the request, enforces the timeout, merges cancellation,
                            validates the response, and turns failures into typed errors
    tree.ts                 turns the flat list into a tree, reports duplicates and cycles,
                            sorts siblings by id, and writes the outline as text
    useCourseSearch.ts      owns a search's lifecycle: starts, supersedes and cancels
                            requests, and keeps the last result through loading and errors
    CourseSearch.tsx        the form: trims the term and hands it to the hook
    SearchResults.tsx       shows the status line, the alert with Try again, and the
                            retained tree; holds the copy
    TreeOutline.tsx         renders the tree as nested lists, one row per node
    *.test.ts, *.test.tsx   tests beside the file they cover
```

Five responsibilities: `client.ts` is transport, `tree.ts` is hierarchy,
`useCourseSearch.ts` is lifecycle, `TreeOutline.tsx` is rendering, and
`CourseSearch.tsx` with `SearchResults.tsx` is composition.

Runtime imports point one way. Components import the hook and `tree.ts`; the
hook imports `client.ts` and `tree.ts`; `client.ts` and `tree.ts` import only
`types.ts`. `App.tsx` imports `course-search` and nothing imports `App.tsx`.
Type-only imports are fine anywhere.

A second feature that reads the tree, such as copying the outline, is a
component beside `TreeOutline.tsx` that takes the roots and calls
`formatOutline`; the hook and the client do not change. A feature that needs
new data from the service, such as a matched flag, starts in `types.ts` and
`parseResponse`, continues in `buildTree` if the tree has to carry it, and
reaches the components last.

## State and the request contract

The hook keeps this state in a reducer:

```ts
type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string; requestId: number }
  | { kind: 'ready'; query: string; requestId: number }
  | { kind: 'error'; query: string; requestId: number; code: SearchErrorCode };

interface State {
  status: Status;
  lastResult: { query: string; roots: TreeNode[] } | null;
}

type SearchErrorCode =
  | 'invalid-query'
  | 'service'
  | 'network'
  | 'timeout'
  | 'invalid-response'
  | 'unusable-data'
  | 'unknown';
```

`lastResult` sits outside `status` because it outlives any one status. The
last tree stays on screen while the next search loads and when that search
fails, so it belongs to neither the `loading` nor the `error` variant. Each
status variant describes only the current request, and the view reads both
fields: the status decides the line above the tree and whether there is an
alert, and `lastResult` decides whether a tree is shown at all.

Requests are tracked outside React state, in a ref holding the active request
`{ requestId, query, controller }`, an id counter and a disposed flag. A new
search aborts the active one, and only the request that still holds its own
id may clear it or dispatch, so a superseded, late or post-unmount settlement
changes nothing, while an abort the hook did not issue is reported as
`unknown` rather than ignored. The eight rules are in the header comment of
`src/course-search/useCourseSearch.ts`.

On success the items go through `buildTree`. Any issue dispatches `failed`
with `unusable-data`; otherwise `succeeded` carries the roots. The reducer
checks `requestId` again and returns the identical state object for a stale
action, so the ref is the first guard and the reducer the second.

## What a result means

The service chooses the items and the app does not know why. The brief's own
example returns items that do not contain the term, so the summary says
"N items returned for “term”", counting every node in the tree, and never
"match". Nothing is highlighted for the same reason.

The last tree with at least one root stays visible through loading, dimmed
and marked `aria-busy`, and under the alert after a failure. When its query is
not the current one, a line above it says "Showing previous results for
“term”". An empty result is not retained: a failure after an empty result
shows only the alert. Names are shown as sent, trailing spaces included, and
a selected row copies as the brief's line for it, prefix and name together.

Failures are shown by what the student can do next. Status codes and issue
details stay inside the error; the view reads only the code.

```
condition                        code              what the student sees
HTTP 400                         invalid-query     rejected term, no button
term cannot be URL-encoded       invalid-query     rejected term, no button
other non-2xx                    service           Try again
fetch rejected by the timer      timeout           Try again
fetch rejected otherwise         network           Try again
bad body or shape                invalid-response  Try again
buildTree issues                 unusable-data     Try again
anything else                    unknown           Try again
```

Non-2xx is decided before any body is read. A term that cannot be URL-encoded
is rejected before any request; an already-aborted signal still wins. The
timeout is ten seconds.

## Hierarchy policy

`buildTree` turns the flat list into `{ roots, issues }`:

```
input                                  placement
parent_id 0                            top level
parent not in the list                 top level, children under it
identical duplicate rows               collapsed
same id, different name or parent      duplicate-id issue
cycle or self-parent, and beneath      cycle issue, affectedIds sorted
```

It never throws, never repairs and never mutates its input, and it walks with
an explicit stack rather than recursion, so a chain thousands deep builds.
When there are issues the roots are still returned, built from the first
occurrence of each id, but the hook treats any issue as unusable data and does
not show them.

The roots and every sibling list are sorted by ascending id. The evidence is
in the brief and in the sandbox: the brief's example places Surface Chemistry
(id 3) before Lab 1 Summary (id 4) and Starch (id 2) before Gum (id 7), which
is id order, and in the sandbox Question 5.1 to 5.8 are ids 88 to 95 while
the order they arrive in is not. That ids reflect authored order is an
assumption supported by the sampled responses (Question 5.1 to 5.8 are ids
88 to 95), not a documented API guarantee.

## Decisions and assumptions

- The brief's `/treesearch/` path returned 404 on 28 to 30 September 2026; the service root returns results, so the client targets the root. `buildSearchUrl` is the one place to change if the path is restored.
- The parser is strict to the observed shape: a bare array of integer `id`, string `name`, integer `parent_id`. One malformed item fails the response, because a partial tree is silently wrong. Names are shown as sent, trailing spaces included.
- Siblings are sorted by ascending id. The brief's example is consistent with it, and sandbox ids follow authored order (Question 5.1 through 5.8 are ids 88 through 95) while response order does not.
- The validated tree is the result. The outline renders it as nested lists with a hyphen prefix per depth; the same walk produces the brief's text format for tests. There is no separate flat representation.
- An item whose parent is not in the result set renders at the top level with its children. In the sandbox every response included ancestors, so this is defensive.
- Corrupt structure (a conflicting duplicate id or a parent cycle) is reported as unusable data and not rendered; the previous result stays on screen. Identical duplicates collapse. Render-with-a-notice was the alternative. Never observed in the sandbox.
- The summary says "N items returned" and never "match", because the brief's example returns items that don't contain the term. No highlighting for the same reason; a `matched` flag from the service is the first thing to add.
- Errors are presented by what the student can do: a rejected term (HTTP 400, the service's invalid-query response) asks for a different term with no retry; service, network, timeout and malformed responses offer Try again; unusable data says so and offers Try again. Status codes stay internal.
- The last good result stays visible through loading (dimmed, `aria-busy`) and errors, labelled with its query when that differs from the current one. An empty result is not retained.
- Duplicate and stale requests are decided by a synchronous active-request ref; the reducer's `requestId` check is a second, pure guard. An aborted rejection is ignored only when this hook aborted it, so a misbehaving client cannot leave the UI stuck. The `disposed` flag is reset in effect setup, so StrictMode's double effect cycle does not disable the hook.
- Ten-second timeout. Terms trimmed. Blank cannot submit. Submitting while loading is allowed. No autofocus.
- Nothing is instrumented. What I would measure for this feature: searches per session, share returning zero items, share failing by recovery type, and time to first result; each of those changes a decision (query guidance, service health, timeout). A telemetry abstraction without a sink is not evidence of that judgment, so it isn't here.
- No data-fetching library (one endpoint, no cache or invalidation), no contexts (the client is a prop), no router, no CSS framework, no external fonts, no backend. Dev and preview proxy `/api`; production resolves the base URL from the environment, then a compiled default.
- The parser type-checks the fields the app depends on and ignores unknown fields, so it survives additive API changes without a release.
- A term that cannot be URL-encoded (a lone surrogate) is treated as a rejected term before any request is sent.
- Try again moves focus to the search field, because the button unmounts with the alert and both of the student's next actions, waiting or changing the term, start there.

## Accessibility

The search field has a visible label and `type="search"`, inside a form with
`role="search"`. Nothing takes focus on load. The results live in a section
labelled "Search results".

The outline is nested `<ul>` elements with `list-style: none`, so a screen
reader hears the depth from the nesting; the hyphen prefix is `aria-hidden`
because it repeats that depth visually. Each list carries an explicit
`role="list"` because Safari removes list semantics from lists styled without
markers. The summary, the searching line and
the no-results line share one `role="status"` element that is always
mounted, so it exists before its text changes. The alert is mounted only while
a search has failed. The retained tree carries `aria-busy` while the next
search loads and is dimmed to match; the dimming transition is removed under
`prefers-reduced-motion`. Try again moves focus to the search field, because
the button unmounts with the alert. Focus rings use `:focus-visible`, and
colours come from tokens with a `prefers-color-scheme: dark` set.

## Testing

Tests sit beside the file they cover. Together they prove that the brief's
example comes out as its seven lines; that the hierarchy policy holds row by
row, including a missing parent, an id of 0, duplicates, cycles, sorting by
numeric id and a chain five thousand deep; that the client maps every
response and failure to the code in the table above, leaves a non-2xx body
unread and clears its timer and abort listener after every outcome; that the
hook follows its eight rules through superseded, late, post-unmount and
foreign-abort settlements, StrictMode and retry, and that the reducer ignores
stale actions; and that the page shows the retained tree, the attribution
line, the alert, Try again with its focus move and the no-results line at the
right moments.

Three things keep the suite honest. `src/test/setup.ts` replaces the global
`fetch` with a function that throws, so a test that reaches for the network
fails at once and every test injects a fetch or a fake client instead. One
journey in `App.test.tsx` runs the real `createHttpSearchClient` with an
injected fetch that answers a 504 HTML page and then the brief's fixture, so
transport, hook and page are exercised together. And the guards were checked
by mutation: with the duplicate-search check, the disposed check, the
foreign-abort condition, the non-2xx check or the missing-parent rule removed
one at a time, the suite fails.

## Verified

Browser checks in Chrome on macOS, Node 22 and 26, 30 September 2026.

- `a`: 350 items returned, sections and questions in id order (Module 1 before 5 before 18; Question 5.1 to 5.8), count equal to the rows on screen.
- `error`: "The search service rejected this term. Try a different one", no Try again button; the `a` tree stayed visible underneath with "Showing previous results for “a”".
- `Chemistry`, which returned 504 on 28 September: 78 items today, so the failure path was exercised offline instead (below).
- `e` followed immediately by `a`: the outline ended on `a`; the late `e` response did not replace it.
- Offline: "Could not reach the search service. Check your connection and try again." with Try again, previous tree retained; back online, Try again recovered.
- Keyboard only: Tab reaches the search field and, after a failure, the Try again button; Enter on Try again returned focus to the search field.
- `Lab 1` and `Gibbs & energy`: requests sent as `?query=Lab%201` and `?query=Gibbs%20%26%20energy`.
- `npm run build && npm run preview`: 350 items for `a` through the preview proxy.
- Clean archive: unpacked into an empty directory; npm ci, lint, typecheck, test, build and preview ran as under Run it, and a search returned results.

## Deployment

`resolveBaseUrl` picks the base URL at build time. `VITE_API_BASE_URL` wins
when it is set and not blank; otherwise the dev server uses `/api`; otherwise
a build uses the compiled default, which is also `/api`. Vite inlines
`import.meta.env` into the bundle, so a change to the environment needs a
rebuild, not a restart.

`/api` is a path on the app's own origin, so whatever serves `dist/` has to
forward it to the service with the prefix removed. `npm run preview` does
this. On a static host the forwarding rule has to be added, for example in
nginx:

```nginx
location /api/ {
  proxy_pass https://coursetreesearch-service-sandbox.dev.tophat.com/;
  proxy_set_header Host coursetreesearch-service-sandbox.dev.tophat.com;
  proxy_ssl_server_name on;
}
```

An SPA fallback is not a forwarding rule. A host that answers every unknown
path with `index.html` would answer `/api/?query=a` with the page itself and
a 200, which the parser rejects as an invalid response.

To call a service directly instead, build with `VITE_API_BASE_URL` set to its
absolute URL; that origin then has to send CORS headers, and the sandbox's
header has been present on some days and absent on others.

Local execution through `npm run dev` and `npm run preview` is the tested
path. No hosted deployment has been exercised.

## Next

- A `matched` flag from the service. Once the service says which items
  matched the term, the summary can count matches and the outline can mark
  them; both are held back today because the app cannot tell.
- Copy outline. A button beside the tree that puts `formatOutline(roots)` on
  the clipboard, the same text the tests compare against.
- Collapsible sections. Each node with children becomes a disclosure, with
  `descendantCount` giving the number hidden behind a closed one.
- URL state. The term in `?q=` so a search can be linked and reloaded, with
  the request contract unchanged.
- i18n. The copy is already in one object, `messages`; the strings would move
  to a locale file and the summary's plural into a plural rule.
- A contract test in CI. A scheduled run against the sandbox that checks the
  root path, the response shape and the 400 for `error`, so a change to the
  service is noticed before a student sees it.

## Process

I used Claude for planning, review and implementation, and made the decisions. Before writing code I put the plan through several review passes, each against a deliberately hard bar, and revised after each one. Those passes changed more than the code's shape. The summary counts items returned rather than matches, because the service returns context items and the app cannot know why an item came back. A failed search keeps the previous result on screen, labelled with its own query. The import direction runs one way, with the client passed in rather than pulled from context. Data integrity became one policy instead of two: missing parents render as partial results, conflicting duplicates and cycles are rejected as unusable data, and nothing is silently repaired. The request lifecycle became a written contract with nine rules, including that dedupe reads a synchronous ref rather than render state, that a disposed flag is reset in effect setup so StrictMode cannot disable the hook, and that only this hook's own aborts are ignored. Errors are presented by what the student can do next. Claims were cut to what could be shown: the tests are named for what they observe, the complexity comment counts the sort, and the browser checks are dated evidence. Real data changed two more decisions: ids follow authored order in every sample, so siblings sort by id, and the corrupt cases the policy handles were not observed, so it is documented as defensive. The result is one canonical tree in seven files, no telemetry and no contexts, on the standard that another engineer should understand the whole feature in one reading and I should be able to say why each piece exists.

The brief's endpoint returns 404 and the service root works, which opens the
Sandbox behaviour section. The lifecycle contract test covers a foreign
abort: a client that rejects as aborted on its own settles as unknown rather
than leaving the hook in loading. I ran every browser check myself, verified
the zip from a clean extraction, and wrote the Decisions, Verified and this
section.

Time spent: 3-4 hours
