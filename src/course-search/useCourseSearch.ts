/*
 * Request contract
 *
 * A ref holds the active request { requestId, query, controller } or null,
 * beside an id counter and a disposed flag owned by a mount effect.
 *
 * 1. search(q): if a request is active and active.query === q, do nothing.
 * 2. Otherwise, if disposed, do nothing. Else abort active.controller,
 *    allocate an id, set active, dispatch started, and call
 *    client.search(q, controller.signal).
 * 3. A request clears active only if active.requestId is its own id.
 * 4. On settle, dispatch only if active.requestId is its own id and disposed
 *    is false. Otherwise nothing.
 * 5. Effect setup sets disposed false; cleanup sets it true, takes and nulls
 *    active, then aborts what it took. This survives StrictMode's setup,
 *    cleanup, setup in development.
 * 6. After cleanup, a late settlement dispatches nothing.
 * 7. retry() reads the query from status and calls search.
 * 8. An 'aborted' rejection is ignored only when this hook's own controller
 *    signal is aborted. Any other aborted rejection settles as unknown and
 *    releases active.
 *
 * On success the items go through buildTree: any issue dispatches failed with
 * unusable-data, otherwise succeeded with the roots.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { TreeSearchError, type SearchClient } from './client';
import { buildTree } from './tree';
import type { CourseItem, SearchErrorCode, TreeNode } from './types';

export type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string; requestId: number }
  | { kind: 'ready'; query: string; requestId: number }
  | { kind: 'error'; query: string; requestId: number; code: SearchErrorCode };

export interface State {
  status: Status;
  lastResult: { query: string; roots: TreeNode[] } | null;
}

export type Action =
  | { type: 'started'; requestId: number; query: string }
  | { type: 'succeeded'; requestId: number; roots: TreeNode[] }
  | { type: 'failed'; requestId: number; code: SearchErrorCode };

export const initialState: State = {
  status: { kind: 'idle' },
  lastResult: null,
};

export function reducer(state: State, action: Action): State {
  const { status } = state;

  if (action.type === 'started') {
    if (status.kind !== 'idle' && status.requestId >= action.requestId) {
      return state;
    }
    return {
      ...state,
      status: {
        kind: 'loading',
        query: action.query,
        requestId: action.requestId,
      },
    };
  }

  if (status.kind !== 'loading' || status.requestId !== action.requestId) {
    return state;
  }
  const { query, requestId } = status;
  if (action.type === 'succeeded') {
    return {
      status: { kind: 'ready', query, requestId },
      lastResult: { query, roots: action.roots },
    };
  }
  return {
    ...state,
    status: { kind: 'error', query, requestId, code: action.code },
  };
}

function codeFor(error: unknown): SearchErrorCode {
  if (error instanceof TreeSearchError && error.kind !== 'aborted') {
    return error.kind;
  }
  return 'unknown';
}

interface ActiveRequest {
  requestId: number;
  query: string;
  controller: AbortController;
}

export function useCourseSearch(client: SearchClient): {
  state: State;
  search: (query: string) => void;
  retry: () => void;
} {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeRef = useRef<ActiveRequest | null>(null);
  const nextIdRef = useRef(1);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const active = activeRef.current;
      activeRef.current = null;
      active?.controller.abort();
    };
  }, []);

  const search = useCallback(
    (query: string) => {
      const active = activeRef.current;
      if (active?.query === query) return;
      // After cleanup nothing owns a request, so none may start.
      if (disposedRef.current) return;
      active?.controller.abort();

      const requestId = nextIdRef.current;
      nextIdRef.current += 1;
      const controller = new AbortController();
      activeRef.current = { requestId, query, controller };
      dispatch({ type: 'started', requestId, query });

      const settle = (action: Action) => {
        if (activeRef.current?.requestId !== requestId) return;
        activeRef.current = null;
        if (!disposedRef.current) dispatch(action);
      };

      // Called inside the executor so a client that throws instead of
      // returning a promise still settles the request.
      new Promise<CourseItem[]>((resolve) => {
        resolve(client.search(query, controller.signal));
      })
        .then(buildTree)
        .then(
          ({ roots, issues }) => {
            settle(
              issues.length > 0
                ? { type: 'failed', requestId, code: 'unusable-data' }
                : { type: 'succeeded', requestId, roots },
            );
          },
          (error: unknown) => {
            if (
              error instanceof TreeSearchError &&
              error.kind === 'aborted' &&
              controller.signal.aborted
            ) {
              return;
            }
            settle({ type: 'failed', requestId, code: codeFor(error) });
          },
        );
    },
    [client],
  );

  const { status } = state;
  const retry = useCallback(() => {
    if (status.kind !== 'idle') search(status.query);
  }, [status, search]);

  return { state, search, retry };
}
