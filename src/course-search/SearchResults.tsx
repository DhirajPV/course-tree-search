import { TreeOutline } from './TreeOutline';
import { descendantCount } from './tree';
import type { SearchErrorCode, TreeNode } from './types';
import type { State } from './useCourseSearch';

const errors: Record<SearchErrorCode, string> = {
  'invalid-query':
    'The search service rejected this term. Try a different one.',
  service: 'The search service had a problem. Try again.',
  network:
    'Could not reach the search service. Check your connection and try again.',
  timeout: 'The search took too long. Try again.',
  'invalid-response':
    'The search service sent back something unexpected. Try again.',
  'unusable-data':
    "The course data for this search came back inconsistent, so it wasn't shown. Try again.",
  unknown: 'Something went wrong while searching. Try again.',
};

export const messages = {
  searchLabel: 'Search term',
  searchButton: 'Search',
  searchPlaceholder: 'e.g. Module',
  resultsRegion: 'Search results',
  treeLabel: 'Course tree',
  tryAgain: 'Try again',
  searching: (query: string) => `Searching for “${query}”…`,
  summary: (query: string, count: number) =>
    `${count} ${count === 1 ? 'item' : 'items'} returned for “${query}”`,
  noResults: (query: string) =>
    `No items returned for “${query}”. Try a different term.`,
  previousResults: (query: string) => `Showing previous results for “${query}”`,
  errors,
};

export function recoveryFor(
  code: SearchErrorCode,
): 'change-query' | 'retry' | 'retry-unusable' {
  if (code === 'invalid-query') return 'change-query';
  if (code === 'unusable-data') return 'retry-unusable';
  return 'retry';
}

function itemCount(roots: readonly TreeNode[]): number {
  return roots.reduce((total, root) => total + 1 + descendantCount(root), 0);
}

function statusText({ status, lastResult }: State): string {
  if (status.kind === 'loading') {
    return messages.searching(status.query);
  }
  if (status.kind === 'ready' && lastResult !== null) {
    return lastResult.roots.length > 0
      ? messages.summary(status.query, itemCount(lastResult.roots))
      : messages.noResults(status.query);
  }
  return '';
}

export function SearchResults({
  state,
  onRetry,
}: {
  state: State;
  onRetry: () => void;
}) {
  const { status, lastResult } = state;
  const retained =
    lastResult !== null && lastResult.roots.length > 0 ? lastResult : null;
  const showsPreviousQuery =
    retained !== null &&
    status.kind !== 'idle' &&
    status.query !== retained.query;

  return (
    <section className="results" aria-label={messages.resultsRegion}>
      {/* Always mounted: a live region has to exist before its text changes. */}
      <p className="results-status" role="status">
        {statusText(state)}
      </p>
      {status.kind === 'error' && (
        <div className="results-error">
          <p role="alert">{messages.errors[status.code]}</p>
          {recoveryFor(status.code) !== 'change-query' && (
            <button type="button" onClick={onRetry}>
              {messages.tryAgain}
            </button>
          )}
        </div>
      )}
      {retained !== null && (
        <div
          className="tree"
          role="group"
          aria-label={messages.treeLabel}
          aria-busy={status.kind === 'loading'}
        >
          {showsPreviousQuery && (
            <p className="tree-attribution">
              {messages.previousResults(retained.query)}
            </p>
          )}
          <TreeOutline roots={retained.roots} />
        </div>
      )}
    </section>
  );
}
