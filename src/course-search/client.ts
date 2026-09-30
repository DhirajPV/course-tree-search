import type { CourseItem } from './types';

export interface SearchClient {
  search(query: string, signal?: AbortSignal): Promise<CourseItem[]>;
}

export type TransportErrorKind =
  | 'invalid-query'
  | 'service'
  | 'network'
  | 'timeout'
  | 'invalid-response'
  | 'aborted';

export class TreeSearchError extends Error {
  readonly kind: TransportErrorKind;
  readonly status?: number;

  constructor(
    kind: TransportErrorKind,
    options: { status?: number; cause?: unknown; detail?: string } = {},
  ) {
    const detail = options.detail === undefined ? '' : ` (${options.detail})`;
    super(`Tree search failed: ${kind}${detail}`, { cause: options.cause });
    this.name = 'TreeSearchError';
    this.kind = kind;
    this.status = options.status;
  }
}

// The sandbox's CORS header has come and gone between runs, so a build talks
// to a same-origin /api that the host forwards (see the README).
const PRODUCTION_BASE_URL = '/api';
const DEFAULT_TIMEOUT_MS = 10_000;

const TIMED_OUT = Symbol('timed out');
const CALLER_ABORTED = Symbol('caller aborted');

export function resolveBaseUrl(env: {
  VITE_API_BASE_URL?: string;
  DEV: boolean;
  productionBaseUrl: string;
}): string {
  const override = env.VITE_API_BASE_URL?.trim();
  if (override) return override;
  return env.DEV ? '/api' : env.productionBaseUrl;
}

// The brief's /treesearch/ path returns 404; the service answers at its root.
export function buildSearchUrl(baseUrl: string, query: string): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(query);
  } catch (cause) {
    // encodeURIComponent throws on half of a surrogate pair. No request can
    // carry that term, so it is the term that has to change.
    throw new TreeSearchError('invalid-query', {
      cause,
      detail: 'query cannot be encoded',
    });
  }
  return `${baseUrl.replace(/\/+$/, '')}/?query=${encoded}`;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseItem(value: unknown, index: number): CourseItem {
  if (typeof value === 'object' && value !== null) {
    const { id, name, parent_id } = value as Record<string, unknown>;
    if (isInteger(id) && typeof name === 'string' && isInteger(parent_id)) {
      return { id, name, parent_id };
    }
  }
  throw new TreeSearchError('invalid-response', {
    detail: `item at index ${index} is not { id: integer, name: string, parent_id: integer }`,
  });
}

export function parseResponse(payload: unknown): CourseItem[] {
  if (!Array.isArray(payload)) {
    throw new TreeSearchError('invalid-response', {
      detail: 'body is not an array',
    });
  }
  return payload.map((value, index) => parseItem(value, index));
}

function classifyFailure(
  signal: AbortSignal,
  otherwise: 'network' | 'invalid-response',
  cause: unknown,
): TreeSearchError {
  // The abort reason is checked before the thrown value because an aborted
  // fetch rejects with whatever the runtime chooses, and only the reason says
  // who aborted.
  if (signal.reason === TIMED_OUT) {
    return new TreeSearchError('timeout', { cause });
  }
  if (signal.aborted) {
    return new TreeSearchError('aborted', { cause });
  }
  return new TreeSearchError(otherwise, { cause });
}

export function createHttpSearchClient({
  baseUrl = resolveBaseUrl({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    DEV: import.meta.env.DEV,
    productionBaseUrl: PRODUCTION_BASE_URL,
  }),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // Looked up per call, and called bare: window.fetch rejects being invoked
  // as a method of another object.
  fetchImpl = (input, init) => fetch(input, init),
}: {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
} = {}): SearchClient {
  return {
    async search(query, signal) {
      const controller = new AbortController();
      const abortForCaller = () => controller.abort(CALLER_ABORTED);
      const timer = setTimeout(() => controller.abort(TIMED_OUT), timeoutMs);
      if (signal?.aborted) {
        abortForCaller();
      } else {
        signal?.addEventListener('abort', abortForCaller, { once: true });
      }

      try {
        if (controller.signal.aborted) {
          throw new TreeSearchError('aborted');
        }

        // Built outside the fetch try so a term that cannot be encoded keeps
        // its invalid-query kind instead of being classified as network.
        const url = buildSearchUrl(baseUrl, query);

        let response: Response;
        try {
          response = await fetchImpl(url, { signal: controller.signal });
        } catch (cause) {
          throw classifyFailure(controller.signal, 'network', cause);
        }

        if (!response.ok) {
          throw new TreeSearchError(
            response.status === 400 ? 'invalid-query' : 'service',
            { status: response.status },
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          throw classifyFailure(controller.signal, 'invalid-response', cause);
        }
        return parseResponse(payload);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortForCaller);
      }
    },
  };
}
