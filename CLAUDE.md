# Course tree search

A student types a term, the app calls the tree search service, and renders
the result as an indented outline with each child under its parent.

Spec: flat list of {id, name, parent_id}; children directly after parents;
hyphens per depth; parent_id 0 is top level; text box, submit button,
results container; catch network errors and say try again; zip plus run
instructions.

## Stack
React 19, TypeScript strict, Vite 7, Vitest (jsdom, globals false), Testing
Library, ESLint 9 flat config, Prettier. Node 22. No other runtime
dependencies, no CDNs, no external fonts, no contexts, no router.

## Layout
  src/main.tsx, src/App.tsx, src/App.test.tsx, src/styles.css
  src/course-search/types.ts, client.ts, tree.ts, useCourseSearch.ts,
    CourseSearch.tsx, SearchResults.tsx, TreeOutline.tsx, tests beside each
Five responsibilities: client.ts transport; tree.ts hierarchy;
useCourseSearch.ts lifecycle; TreeOutline.tsx rendering; CourseSearch.tsx
and SearchResults.tsx composition. Runtime imports: components -> hook,
tree; hook -> client, tree; client and tree -> types only. Type-only
imports are fine anywhere. App imports course-search; never the reverse.
No other folders.

## Interfaces
types.ts
  export interface CourseItem { id: number; name: string; parent_id: number }
  export interface TreeNode { id: number; name: string; children: TreeNode[] }
  export type DataIssue =
    | { kind: 'duplicate-id'; id: number }
    | { kind: 'cycle'; affectedIds: number[] }   // unreachable from any root, sorted
  export type SearchErrorCode =
    'invalid-query' | 'service' | 'network' | 'timeout' | 'invalid-response' | 'unusable-data' | 'unknown'

client.ts
  export interface SearchClient { search(query: string, signal?: AbortSignal): Promise<CourseItem[]> }
  export type TransportErrorKind = 'invalid-query' | 'service' | 'network' | 'timeout' | 'invalid-response' | 'aborted'
  export class TreeSearchError extends Error { readonly kind: TransportErrorKind; readonly status?: number }
  export function resolveBaseUrl(env: { VITE_API_BASE_URL?: string; DEV: boolean; productionBaseUrl: string }): string
  export function buildSearchUrl(baseUrl: string, query: string): string   // {base}/?query=<encoded>
  export function parseResponse(payload: unknown): CourseItem[]   // errors name the offending index; a non-array body says so
  export function createHttpSearchClient(o?: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): SearchClient
  Timeout default 10_000.

tree.ts
  export function buildTree(items: readonly CourseItem[]): { roots: TreeNode[]; issues: DataIssue[] }
  export function prefixFor(depth: number): string                 // "- ".repeat(depth), the only definition
  export function formatOutline(roots: readonly TreeNode[]): string  // the brief's lines, depth-first, joined by \n
  export function descendantCount(node: TreeNode): number

useCourseSearch.ts
  type Status = idle | loading{query, requestId} | ready{query, requestId} | error{query, requestId, code}
  interface State { status: Status; lastResult: { query: string; roots: TreeNode[] } | null }
  export function useCourseSearch(client: SearchClient): { state: State; search(query: string): void; retry(): void }
  Reducer in this file; stale actions return the identical object.

Components
  CourseSearch({ client: SearchClient })
  SearchResults({ state: State; onRetry(): void })
    also exports: const messages (see Copy) and
    recoveryFor(code: SearchErrorCode): 'change-query' | 'retry' | 'retry-unusable'
  TreeOutline({ roots: readonly TreeNode[] })
src/App.tsx: export default function App({ client?: SearchClient })   // defaults to createHttpSearchClient(), built once

## Request contract (hook header carries these)
Ref: active { requestId, query, controller } | null; id counter; disposed
flag owned by a mount effect.
1. search(q): if active and active.query === q, do nothing.
2. Else, if disposed, do nothing. Otherwise abort active.controller,
   allocate an id, set active, dispatch started, call
   client.search(q, controller.signal).
3. A request clears active only if active.requestId is its own id.
4. On settle, dispatch only if active.requestId is its own id and disposed
   is false. Otherwise nothing.
5. Effect setup sets disposed false; cleanup sets it true, takes and nulls
   active, then aborts what it took. Survives StrictMode's setup, cleanup,
   setup in development.
6. After cleanup, late settlement dispatches nothing.
7. retry() reads the query from status and calls search.
8. An 'aborted' rejection is ignored only when this hook's own controller
   signal is aborted. Any other aborted rejection settles as unknown and
   releases active.
On success: buildTree; non-empty issues dispatch failed with unusable-data;
else succeeded with roots.

## Error mapping and recovery
  400                        -> invalid-query    change-query   no button
  term cannot be URL-encoded -> invalid-query    change-query   no button
  other non-2xx              -> service          retry
  fetch rejected, timer      -> timeout          retry
  fetch rejected, other      -> network          retry
  bad body or shape          -> invalid-response retry
  buildTree issues           -> unusable-data    retry-unusable
  anything else              -> unknown          retry
Non-2xx is decided before any body read. A term that cannot be URL-encoded
is thrown before any request; an already-aborted signal still wins. Status
codes and issue details stay inside the error; the UI reads the code and the
recovery.

## Hierarchy policy
  parent_id 0                          top level
  parent not in the list               top level, children under it
  identical duplicate rows             collapsed
  same id, different name or parent    duplicate-id issue
  cycle or self-parent, and beneath    cycle issue, affectedIds sorted
buildTree never throws, never repairs, never mutates input. Roots and
every sibling list sorted by ascending id (stable). Explicit stack.

## Result and retention
"N items returned", never "match". No highlighting. lastResult stays
through loading (dimmed, aria-busy) and error (under the alert); when its
query differs from the current one show previousResults(lastResult.query).
Zero roots are not retained: a failure after an empty result shows only
the alert.

## Observed (sandbox, 28 to 30 Sept 2026)
- /treesearch/ returns 404 with and without the trailing slash; the root
  returns results at {base}/?query=term.
- Bare array; item {"id":88,"name":"Question 5.1","parent_id":87}; integers
  and a string; no extra fields seen.
- ?query=error: 400 {"detail":"Query invalid"}.
- Single letters return most of the course: a 350, e 369, i 363, Module
  344, Question 278; about 24 KB. Lab returns [].
- No duplicate ids, missing parents or cycles across those; ancestors
  always included; 19 names carry trailing whitespace.
- Responses vary between runs: o returned a non-array JSON body once;
  Chemistry, Experiment, Colloidal returned 504 with HTML on the 28th.
- access-control-allow-origin: * for Origin http://localhost:5173.

## Assumed
Results are the items the service chose; why is unknown. Ids reflect
authored order: an assumption supported by the sampled responses (Question
5.1 to 5.8 are ids 88 to 95), not a documented API guarantee. Non-2xx
statuses other than 400 have no specific recovery.

## Decisions
parseResponse: extra fields are ignored so the parser survives additive API
changes; known fields are type-checked.

## Production base URL
'/api', same origin. The sandbox's CORS header has come and gone, so a build
does not call the service directly; dev and preview forward /api, and the
README has a forwarding-proxy example for any other host. VITE_API_BASE_URL
overrides it.

## Copy (exported from SearchResults.tsx as `messages`; tests reference it)
  searchLabel Search term | searchButton Search | searchPlaceholder e.g. Module
  resultsRegion Search results | treeLabel Course tree | tryAgain Try again
  searching(q)         Searching for “{q}”…
  summary(q, n)        {n} items returned for “{q}”   (singular: 1 item returned)
  noResults(q)         No items returned for “{q}”. Try a different term.
  previousResults(q)   Showing previous results for “{q}”
  errors.invalid-query     The search service rejected this term. Try a different one.
  errors.service           The search service had a problem. Try again.
  errors.network           Could not reach the search service. Check your connection and try again.
  errors.timeout           The search took too long. Try again.
  errors.invalid-response  The search service sent back something unexpected. Try again.
  errors.unusable-data     The course data for this search came back inconsistent, so it wasn't shown. Try again.
  errors.unknown           Something went wrong while searching. Try again.

## Accessibility
Nested <ul>, list-style none; prefix aria-hidden. Summary in a polite
role="status"; alert only while erroring; aria-busy on the retained tree;
focus rings; reduced motion; no autofocus.
Every <ul> carries role="list": Safari removes list semantics from lists
styled without markers.
Try again moves focus to the search input: the button unmounts with the
alert, and waiting or changing the term both start there.

## Spec example
Input (API order): 5 Chemical Kinetics -> 6; 3 Surface Chemistry -> 1;
1 Lab Experiment 1 -> 0; 4 Lab 1 Summary -> 1; 2 Colloidal Solution (sol) of
Starch -> 3; 6 Lab Experiment 2 -> 0; 7 Colloidal Solution of Gum -> 3.
formatOutline gives:
  Lab Experiment 1
  - Surface Chemistry
  - - Colloidal Solution (sol) of Starch
  - - Colloidal Solution of Gum
  - Lab 1 Summary
  Lab Experiment 2
  - Chemical Kinetics
Sandbox fixture: 85 Module 5 -> 0; 87 Slides -> 85; 88..95 Question
5.1..5.8 -> 87.

## Not built, and why
Copy full outline and collapsible sections are the next two features, in
that order; ?q= in the URL and instrumentation are deferred. What would be
measured, and why nothing is instrumented, is in the README.

## Comments
A comment says why, or it goes.

## Verify
  npm run lint && npm run typecheck && npm test && npm run build && npm run lint
Tests never reach the network: setup stubs fetch to throw; every test
injects fetch or a fake client. One journey runs the real client.