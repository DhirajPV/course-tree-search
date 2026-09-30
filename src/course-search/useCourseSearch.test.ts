import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TreeSearchError, type SearchClient } from './client';
import type { CourseItem, TreeNode } from './types';
import {
  initialState,
  reducer,
  useCourseSearch,
  type Action,
  type State,
} from './useCourseSearch';

interface Call {
  query: string;
  signal: AbortSignal | undefined;
  resolve: (items: CourseItem[]) => void;
  reject: (reason: unknown) => void;
}

class FakeClient implements SearchClient {
  readonly calls: Call[] = [];

  search(query: string, signal?: AbortSignal): Promise<CourseItem[]> {
    return new Promise((resolve, reject) => {
      this.calls.push({ query, signal, resolve, reject });
    });
  }
}

// The hook reacts several promise hops after the client settles. act's async
// form waits out a full task before returning, which covers all of them.
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}

function renderSearch(client: SearchClient) {
  return renderHook(() => useCourseSearch(client));
}

const labItems: CourseItem[] = [
  { id: 3, name: 'Surface Chemistry', parent_id: 1 },
  { id: 1, name: 'Lab Experiment 1', parent_id: 0 },
];
const labRoots: TreeNode[] = [
  {
    id: 1,
    name: 'Lab Experiment 1',
    children: [{ id: 3, name: 'Surface Chemistry', children: [] }],
  },
];
const examItems: CourseItem[] = [{ id: 9, name: 'Exam 1', parent_id: 0 }];
const examRoots: TreeNode[] = [{ id: 9, name: 'Exam 1', children: [] }];
const cyclicItems: CourseItem[] = [
  { id: 1, name: 'Lab Experiment 1', parent_id: 2 },
  { id: 2, name: 'Surface Chemistry', parent_id: 1 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCourseSearch', () => {
  it('goes from loading to ready with the tree of a successful search', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
    });

    expect(result.current.state.status).toMatchObject({
      kind: 'loading',
      query: 'Lab',
    });
    expect(client.calls.map((call) => call.query)).toEqual(['Lab']);

    await settle(() => client.calls[0].resolve(labItems));

    expect(result.current.state.status).toMatchObject({
      kind: 'ready',
      query: 'Lab',
    });
    expect(result.current.state.lastResult).toEqual({
      query: 'Lab',
      roots: labRoots,
    });
  });

  it('sets invalid-query when the service answers 400', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('error');
    });
    await settle(() =>
      client.calls[0].reject(
        new TreeSearchError('invalid-query', { status: 400 }),
      ),
    );

    expect(result.current.state.status).toMatchObject({
      kind: 'error',
      query: 'error',
      code: 'invalid-query',
    });
    expect(result.current.state.lastResult).toBeNull();
  });

  it('calls the client once for two identical searches in one tick', () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
      result.current.search('Lab');
    });

    expect(client.calls).toHaveLength(1);
  });

  it('calls the client again for the same query once the first has settled', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
    });
    await settle(() => client.calls[0].resolve(labItems));
    act(() => {
      result.current.search('Lab');
    });

    expect(client.calls.map((call) => call.query)).toEqual(['Lab', 'Lab']);
  });

  it('aborts a superseded search, ignores its late result and keeps the newer one', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('a');
    });
    act(() => {
      result.current.search('b');
    });
    const [a, b] = client.calls;

    expect(a.signal?.aborted).toBe(true);
    expect(b.signal?.aborted).toBe(false);

    const beforeLateResult = result.current.state;
    await settle(() => a.resolve(labItems));

    expect(result.current.state).toBe(beforeLateResult);

    await settle(() => b.resolve(examItems));

    expect(result.current.state.status).toMatchObject({
      kind: 'ready',
      query: 'b',
    });
    expect(result.current.state.lastResult).toEqual({
      query: 'b',
      roots: examRoots,
    });
  });

  // The reducer drops a stale action by itself, so the state cannot show
  // whether a late settlement released the request that replaced it.
  it('keeps the newer search active when a superseded one settles late', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('a');
    });
    act(() => {
      result.current.search('b');
    });
    await settle(() => client.calls[0].resolve(labItems));
    act(() => {
      result.current.search('b');
    });

    expect(client.calls.map((call) => call.query)).toEqual(['a', 'b']);
  });

  it('aborts the pending signal on unmount and lets that request settle without an error', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const client = new FakeClient();
    const { result, unmount } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
    });
    expect(client.calls[0].signal?.aborted).toBe(false);

    unmount();

    expect(client.calls[0].signal?.aborted).toBe(true);

    // result.current stays frozen at the last render before the unmount, so
    // the state says nothing here; a clean settlement is all there is to see.
    await expect(
      settle(() => client.calls[0].resolve(labItems)),
    ).resolves.toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not call the client for a search made after unmount', () => {
    const client = new FakeClient();
    const { result, unmount } = renderSearch(client);
    const { search } = result.current;

    unmount();
    search('a');

    expect(client.calls).toHaveLength(0);
  });

  it('still reaches ready under StrictMode', async () => {
    const client = new FakeClient();
    const { result } = renderHook(() => useCourseSearch(client), {
      wrapper: StrictMode,
    });

    act(() => {
      result.current.search('Lab');
    });
    await settle(() => client.calls[0].resolve(labItems));

    expect(client.calls).toHaveLength(1);
    expect(result.current.state.status).toMatchObject({
      kind: 'ready',
      query: 'Lab',
    });
    expect(result.current.state.lastResult).toEqual({
      query: 'Lab',
      roots: labRoots,
    });
  });

  it('sets unknown for an aborted rejection it did not cause, and lets the next search through', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
    });
    await settle(() => client.calls[0].reject(new TreeSearchError('aborted')));

    expect(client.calls[0].signal?.aborted).toBe(false);
    expect(result.current.state.status).toMatchObject({
      kind: 'error',
      query: 'Lab',
      code: 'unknown',
    });

    act(() => {
      result.current.search('Lab');
    });

    expect(client.calls).toHaveLength(2);
  });

  it('sets unusable-data for a cyclic response and keeps the last result', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
    });
    await settle(() => client.calls[0].resolve(labItems));
    act(() => {
      result.current.search('Exam');
    });
    await settle(() => client.calls[1].resolve(cyclicItems));

    expect(result.current.state.status).toMatchObject({
      kind: 'error',
      query: 'Exam',
      code: 'unusable-data',
    });
    expect(result.current.state.lastResult).toEqual({
      query: 'Lab',
      roots: labRoots,
    });
  });

  it('calls the client with the same query when retrying after an error', async () => {
    const client = new FakeClient();
    const { result } = renderSearch(client);

    act(() => {
      result.current.search('Lab');
    });
    await settle(() =>
      client.calls[0].reject(new TreeSearchError('service', { status: 500 })),
    );
    act(() => {
      result.current.retry();
    });

    expect(client.calls.map((call) => call.query)).toEqual(['Lab', 'Lab']);
    expect(result.current.state.status).toMatchObject({
      kind: 'loading',
      query: 'Lab',
    });
  });
});

describe('reducer', () => {
  const lastResult = { query: 'Lab', roots: labRoots };
  const loading: State = {
    status: { kind: 'loading', query: 'Exam', requestId: 2 },
    lastResult,
  };
  const ready: State = {
    status: { kind: 'ready', query: 'Lab', requestId: 2 },
    lastResult,
  };
  const failed: State = {
    status: { kind: 'error', query: 'Exam', requestId: 2, code: 'service' },
    lastResult,
  };

  it.each<{ label: string; state: State; action: Action }>([
    {
      label: 'a start older than the current request',
      state: loading,
      action: { type: 'started', requestId: 1, query: 'Lab' },
    },
    {
      label: 'a repeated start of the current request',
      state: loading,
      action: { type: 'started', requestId: 2, query: 'Exam' },
    },
    {
      label: 'a success from a superseded request',
      state: loading,
      action: { type: 'succeeded', requestId: 1, roots: examRoots },
    },
    {
      label: 'a failure from a superseded request',
      state: loading,
      action: { type: 'failed', requestId: 1, code: 'network' },
    },
    {
      label: 'a success for a request that already succeeded',
      state: ready,
      action: { type: 'succeeded', requestId: 2, roots: examRoots },
    },
    {
      label: 'a failure for a request that already succeeded',
      state: ready,
      action: { type: 'failed', requestId: 2, code: 'network' },
    },
    {
      label: 'a success for a request that already failed',
      state: failed,
      action: { type: 'succeeded', requestId: 2, roots: examRoots },
    },
    {
      label: 'a settlement before any search',
      state: initialState,
      action: { type: 'succeeded', requestId: 1, roots: examRoots },
    },
  ])('returns the identical object for $label', ({ state, action }) => {
    expect(reducer(state, action)).toBe(state);
  });
});
