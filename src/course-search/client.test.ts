import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TreeSearchError,
  buildSearchUrl,
  createHttpSearchClient,
  parseResponse,
  resolveBaseUrl,
} from './client';
import type { CourseItem } from './types';

const observed: CourseItem[] = [
  { id: 85, name: 'Module 5', parent_id: 0 },
  { id: 87, name: 'Slides', parent_id: 85 },
  { id: 88, name: 'Question 5.1', parent_id: 87 },
];

// Half of a surrogate pair, which encodeURIComponent refuses.
const unencodableTerm = 'Lab \u{D83D}';

const abortError = () =>
  new DOMException('The operation was aborted.', 'AbortError');

// The two fakes below abort the way the platform's fetch does, because the
// client is only ever told about an abort or a timeout through its signal.
const neverResponds: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(abortError()));
  });

function headersThenStalledBody(): {
  response: Response;
  fetchImpl: typeof fetch;
} {
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
    }),
  );
  return {
    response,
    fetchImpl: (_input, init) => {
      init?.signal?.addEventListener('abort', () => body?.error(abortError()));
      return Promise.resolve(response);
    },
  };
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (reason) {
    return reason;
  }
  throw new Error('Expected a throw');
}

describe('resolveBaseUrl', () => {
  it('prefers VITE_API_BASE_URL in development and in a build', () => {
    const override = { VITE_API_BASE_URL: ' https://search.test/tree ' };

    expect(
      resolveBaseUrl({ ...override, DEV: true, productionBaseUrl: '/built' }),
    ).toBe('https://search.test/tree');
    expect(
      resolveBaseUrl({ ...override, DEV: false, productionBaseUrl: '/built' }),
    ).toBe('https://search.test/tree');
  });

  it('ignores a blank override', () => {
    expect(
      resolveBaseUrl({
        VITE_API_BASE_URL: '  ',
        DEV: false,
        productionBaseUrl: '/built',
      }),
    ).toBe('/built');
  });

  it('uses the dev proxy path in development and the production base in a build', () => {
    expect(resolveBaseUrl({ DEV: true, productionBaseUrl: '/built' })).toBe(
      '/api',
    );
    expect(resolveBaseUrl({ DEV: false, productionBaseUrl: '/built' })).toBe(
      '/built',
    );
  });
});

describe('buildSearchUrl', () => {
  it('targets the service root with the query encoded', () => {
    expect(buildSearchUrl('/api', 'Question 5')).toBe(
      '/api/?query=Question%205',
    );
    expect(buildSearchUrl('https://search.test', 'Module')).toBe(
      'https://search.test/?query=Module',
    );
  });

  it('does not double the slash of a base that ends in one', () => {
    expect(buildSearchUrl('https://search.test/', 'Module')).toBe(
      'https://search.test/?query=Module',
    );
    expect(buildSearchUrl('/api//', 'Module')).toBe('/api/?query=Module');
  });

  it('encodes characters that would otherwise change the URL', () => {
    expect(buildSearchUrl('/api', 'a&query=b#c?d/e+f%')).toBe(
      '/api/?query=a%26query%3Db%23c%3Fd%2Fe%2Bf%25',
    );
    expect(buildSearchUrl('/api', 'Défi 5')).toBe('/api/?query=D%C3%A9fi%205');
  });

  it('throws invalid-query for a term holding half of a surrogate pair', () => {
    const error = thrownBy(() => buildSearchUrl('/api', unencodableTerm));

    expect(error).toBeInstanceOf(TreeSearchError);
    expect(error).toMatchObject({ kind: 'invalid-query' });
    expect((error as TreeSearchError).cause).toBeInstanceOf(URIError);
  });
});

describe('parseResponse', () => {
  it('accepts the bare array the sandbox returns', () => {
    expect(parseResponse(observed)).toEqual(observed);
    expect(parseResponse([])).toEqual([]);
  });

  it('accepts a name with trailing whitespace and an id of 0', () => {
    const items = [{ id: 0, name: 'Module 5 ', parent_id: 0 }];

    expect(parseResponse(items)).toEqual(items);
  });

  it('ignores fields it does not know', () => {
    expect(
      parseResponse([
        { id: 85, name: 'Module 5', parent_id: 0, position: 3, tags: [] },
      ]),
    ).toEqual([{ id: 85, name: 'Module 5', parent_id: 0 }]);
  });

  it.each<[string, unknown]>([
    ['a string', 'Query invalid'],
    ['an object container', { results: observed }],
    ['null', null],
    ['a number', 7],
  ])('rejects %s in place of the array', (_name, payload) => {
    const error = thrownBy(() => parseResponse(payload));

    expect(error).toBeInstanceOf(TreeSearchError);
    expect(error).toMatchObject({ kind: 'invalid-response' });
  });

  it.each<[string, unknown]>([
    ['a missing name', { id: 89, parent_id: 87 }],
    ['a non-integer id', { id: 88.5, name: 'Question 5.2', parent_id: 87 }],
    [
      'an id sent as a string',
      { id: '89', name: 'Question 5.2', parent_id: 87 },
    ],
    ['a name that is not a string', { id: 89, name: 52, parent_id: 87 }],
    ['a missing parent_id', { id: 89, name: 'Question 5.2' }],
    ['a null parent_id', { id: 89, name: 'Question 5.2', parent_id: null }],
    ['an id too large to be exact', { id: 2 ** 53, name: 'Big', parent_id: 0 }],
    ['null', null],
    ['a bare string', 'Question 5.2'],
  ])('rejects an item with %s, naming its index', (_name, item) => {
    const error = thrownBy(() => parseResponse([...observed, item]));

    expect(error).toBeInstanceOf(TreeSearchError);
    expect(error).toMatchObject({ kind: 'invalid-response' });
    expect((error as TreeSearchError).message).toMatch(/\bindex 3\b/);
  });

  it('names the first bad index when several items are wrong', () => {
    const error = thrownBy(() =>
      parseResponse([observed[0], { id: 1 }, observed[1], { id: 2 }]),
    );

    expect((error as TreeSearchError).message).toMatch(/\bindex 1\b/);
  });
});

describe('createHttpSearchClient', () => {
  it('requests the service root and returns the items of a 200', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(observed)),
    );
    const client = createHttpSearchClient({ baseUrl: '/api', fetchImpl });

    await expect(client.search('Question 5')).resolves.toEqual(observed);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/?query=Question%205');
  });

  it('returns an empty list for an empty array', async () => {
    const client = createHttpSearchClient({
      baseUrl: '/api',
      fetchImpl: () => Promise.resolve(Response.json([])),
    });

    await expect(client.search('Lab')).resolves.toEqual([]);
  });

  it.each([
    [400, 'invalid-query', '{"detail":"Query invalid"}'],
    [503, 'service', '<html>Service Unavailable</html>'],
    [504, 'service', '<html>Gateway Time-out</html>'],
    [404, 'service', '{"detail":"Not Found"}'],
    [500, 'service', ''],
  ])(
    'rejects a %i as %s, keeping the status and leaving the body unread',
    async (status, kind, body) => {
      const response = new Response(body, { status });
      const client = createHttpSearchClient({
        baseUrl: '/api',
        fetchImpl: () => Promise.resolve(response),
      });

      const error: unknown = await client
        .search('Module')
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(TreeSearchError);
      expect(error).toMatchObject({ kind, status });
      expect(response.bodyUsed).toBe(false);
    },
  );

  it('rejects a fetch that fails with a TypeError as a network error', async () => {
    const cause = new TypeError('Failed to fetch');
    const client = createHttpSearchClient({
      baseUrl: '/api',
      fetchImpl: () => Promise.reject(cause),
    });

    const error: unknown = await client
      .search('Module')
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TreeSearchError);
    expect(error).toMatchObject({ kind: 'network' });
    expect((error as TreeSearchError).cause).toBe(cause);
    expect((error as TreeSearchError).status).toBeUndefined();
  });

  it('rejects, rather than throws, when fetch itself throws', async () => {
    const client = createHttpSearchClient({
      baseUrl: '/api',
      fetchImpl: () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(client.search('Module')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it.each([
    ['an HTML page', '<!doctype html><html><body>Gateway</body></html>'],
    ['an empty body', ''],
    ['truncated JSON', '[{"id":85,"name":"Module 5","par'],
    ['a JSON object', '{"detail":"Query invalid"}'],
    ['an item of the wrong shape', '[{"id":"85","name":"Module 5"}]'],
  ])(
    'rejects a 200 carrying %s as an invalid response',
    async (_name, body) => {
      const client = createHttpSearchClient({
        baseUrl: '/api',
        fetchImpl: () => Promise.resolve(new Response(body)),
      });

      const error: unknown = await client
        .search('Module')
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(TreeSearchError);
      expect(error).toMatchObject({ kind: 'invalid-response' });
    },
  );

  it('rejects a term that cannot be encoded as invalid-query and never calls fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(observed)),
    );
    const client = createHttpSearchClient({ baseUrl: '/api', fetchImpl });

    const error: unknown = await client
      .search(unencodableTerm)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TreeSearchError);
    expect(error).toMatchObject({ kind: 'invalid-query' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe('when the caller aborts', () => {
    it('rejects an already-aborted signal as aborted and never calls fetch', async () => {
      const caller = new AbortController();
      caller.abort();
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json(observed)),
      );
      const client = createHttpSearchClient({ baseUrl: '/api', fetchImpl });

      const error: unknown = await client
        .search('Module', caller.signal)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(TreeSearchError);
      expect(error).toMatchObject({ kind: 'aborted' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects as aborted while waiting for the response', async () => {
      const caller = new AbortController();
      const client = createHttpSearchClient({
        baseUrl: '/api',
        fetchImpl: neverResponds,
      });

      const search = client.search('Module', caller.signal);
      caller.abort();

      await expect(search).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('stays aborted when the abort lands after the headers, during the body read', async () => {
      const caller = new AbortController();
      const { response, fetchImpl } = headersThenStalledBody();
      const client = createHttpSearchClient({ baseUrl: '/api', fetchImpl });

      const search = client.search('Module', caller.signal);
      await vi.waitFor(() => {
        expect(response.bodyUsed).toBe(true);
      });
      caller.abort();

      await expect(search).rejects.toMatchObject({ kind: 'aborted' });
    });
  });

  describe('with a timeout', () => {
    beforeEach(() => {
      // Only the timeout's own timer is faked; the response body is a real
      // stream and must keep whatever scheduling it uses.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects as timeout when no response arrives in time', async () => {
      const client = createHttpSearchClient({
        baseUrl: '/api',
        timeoutMs: 2_000,
        fetchImpl: neverResponds,
      });
      const settled = vi.fn();

      const search = client.search('Module');
      const outcome = expect(search).rejects.toMatchObject({ kind: 'timeout' });
      void search.catch(() => undefined).finally(settled);

      await vi.advanceTimersByTimeAsync(1_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
    });

    it('waits ten seconds when no timeout is given', async () => {
      const client = createHttpSearchClient({
        baseUrl: '/api',
        fetchImpl: neverResponds,
      });
      const settled = vi.fn();

      const search = client.search('Module');
      const outcome = expect(search).rejects.toMatchObject({ kind: 'timeout' });
      void search.catch(() => undefined).finally(settled);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
    });

    it('stays a timeout when the time runs out after the headers, during the body read', async () => {
      const { response, fetchImpl } = headersThenStalledBody();
      const client = createHttpSearchClient({
        baseUrl: '/api',
        timeoutMs: 2_000,
        fetchImpl,
      });

      const search = client.search('Module');
      const outcome = expect(search).rejects.toMatchObject({ kind: 'timeout' });

      await vi.advanceTimersByTimeAsync(1_999);
      expect(response.bodyUsed).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
    });

    it('stays a timeout when the caller aborts after the time ran out', async () => {
      const caller = new AbortController();
      const fetchImpl: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            caller.abort();
            reject(abortError());
          });
        });
      const client = createHttpSearchClient({
        baseUrl: '/api',
        timeoutMs: 2_000,
        fetchImpl,
      });

      const search = client.search('Module', caller.signal);
      const outcome = expect(search).rejects.toMatchObject({ kind: 'timeout' });

      await vi.advanceTimersByTimeAsync(2_000);
      await outcome;
    });

    describe('cleanup', () => {
      function watchedCaller() {
        const controller = new AbortController();
        return {
          controller,
          added: vi.spyOn(controller.signal, 'addEventListener'),
          removed: vi.spyOn(controller.signal, 'removeEventListener'),
        };
      }

      function expectNothingLeftBehind({
        added,
        removed,
      }: ReturnType<typeof watchedCaller>) {
        expect(vi.getTimerCount()).toBe(0);
        for (const [type, listener] of added.mock.calls) {
          expect(removed).toHaveBeenCalledWith(type, listener);
        }
      }

      it.each<[string, typeof fetch]>([
        ['a 200', () => Promise.resolve(Response.json(observed))],
        ['a 400', () => Promise.resolve(new Response(null, { status: 400 }))],
        ['a 503', () => Promise.resolve(new Response(null, { status: 503 }))],
        ['a failed fetch', () => Promise.reject(new TypeError('Failed'))],
        ['an unreadable body', () => Promise.resolve(new Response('<html>'))],
        ['a wrong shape', () => Promise.resolve(Response.json({ id: 1 }))],
      ])(
        'clears the timer and stops listening to the caller after %s',
        async (_name, fetchImpl) => {
          const caller = watchedCaller();
          const client = createHttpSearchClient({ baseUrl: '/api', fetchImpl });

          await client
            .search('Module', caller.controller.signal)
            .catch(() => undefined);

          expect(caller.added).toHaveBeenCalled();
          expectNothingLeftBehind(caller);
        },
      );

      it('clears the timer and stops listening for a term that cannot be encoded', async () => {
        const caller = watchedCaller();
        const client = createHttpSearchClient({
          baseUrl: '/api',
          fetchImpl: neverResponds,
        });

        await client
          .search(unencodableTerm, caller.controller.signal)
          .catch(() => undefined);

        expectNothingLeftBehind(caller);
      });

      it('leaves no timer behind for an already-aborted signal', async () => {
        const caller = watchedCaller();
        caller.controller.abort();
        const client = createHttpSearchClient({
          baseUrl: '/api',
          fetchImpl: neverResponds,
        });

        await client
          .search('Module', caller.controller.signal)
          .catch(() => undefined);

        expectNothingLeftBehind(caller);
      });

      it.each([
        ['before the headers', () => neverResponds],
        ['during the body read', () => headersThenStalledBody().fetchImpl],
      ])(
        'clears the timer and stops listening after an abort %s',
        async (_name, makeFetch) => {
          const caller = watchedCaller();
          const client = createHttpSearchClient({
            baseUrl: '/api',
            fetchImpl: makeFetch(),
          });

          const search = client
            .search('Module', caller.controller.signal)
            .catch(() => undefined);
          await vi.advanceTimersByTimeAsync(1);
          caller.controller.abort();
          await search;

          expectNothingLeftBehind(caller);
        },
      );

      it.each([
        ['before the headers', () => neverResponds],
        ['during the body read', () => headersThenStalledBody().fetchImpl],
      ])(
        'stops listening to the caller after a timeout %s',
        async (_name, makeFetch) => {
          const caller = watchedCaller();
          const client = createHttpSearchClient({
            baseUrl: '/api',
            timeoutMs: 2_000,
            fetchImpl: makeFetch(),
          });

          const search = client
            .search('Module', caller.controller.signal)
            .catch(() => undefined);
          await vi.advanceTimersByTimeAsync(2_000);
          await search;

          expect(caller.added).toHaveBeenCalled();
          expectNothingLeftBehind(caller);
        },
      );
    });
  });
});
