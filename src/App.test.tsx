import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import App from './App';
import { messages } from './course-search/SearchResults';
import {
  TreeSearchError,
  createHttpSearchClient,
  type SearchClient,
} from './course-search/client';
import type { CourseItem } from './course-search/types';

const specExample: CourseItem[] = [
  { id: 5, name: 'Chemical Kinetics', parent_id: 6 },
  { id: 3, name: 'Surface Chemistry', parent_id: 1 },
  { id: 1, name: 'Lab Experiment 1', parent_id: 0 },
  { id: 4, name: 'Lab 1 Summary', parent_id: 1 },
  { id: 2, name: 'Colloidal Solution (sol) of Starch', parent_id: 3 },
  { id: 6, name: 'Lab Experiment 2', parent_id: 0 },
  { id: 7, name: 'Colloidal Solution of Gum', parent_id: 3 },
];
const specOutline = [
  'Lab Experiment 1',
  '- Surface Chemistry',
  '- - Colloidal Solution (sol) of Starch',
  '- - Colloidal Solution of Gum',
  '- Lab 1 Summary',
  'Lab Experiment 2',
  '- Chemical Kinetics',
];
const examItems: CourseItem[] = [
  { id: 21, name: 'Exam 1 Review', parent_id: 20 },
  { id: 20, name: 'Exam 1', parent_id: 0 },
];
const examOutline = ['Exam 1', '- Exam 1 Review'];

interface Call {
  query: string;
  resolve: (items: CourseItem[]) => void;
  reject: (reason: unknown) => void;
}

function createFakeClient(): { client: SearchClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: SearchClient = {
    search: (query) =>
      new Promise((resolve, reject) => {
        calls.push({ query, resolve, reject });
      }),
  };
  return { client, calls };
}

// act's async form waits out a full task, long enough for the hook to react to
// the settled promise whether or not it changes anything on screen.
async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}

async function searchFor(user: UserEvent, term: string): Promise<void> {
  const input = screen.getByRole('searchbox', { name: messages.searchLabel });
  await user.clear(input);
  await user.type(input, term);
  await user.click(screen.getByRole('button', { name: messages.searchButton }));
}

function outline(): (string | null)[] {
  return screen.queryAllByTestId('tree-row').map((row) => row.textContent);
}

it('keeps the “Lab” tree with its attribution when “Exam” fails with a 500, and Try again refetches “Exam”', async () => {
  const { client, calls } = createFakeClient();
  const user = userEvent.setup();
  render(<App client={client} />);

  await searchFor(user, 'Lab');
  await settle(() => calls[0].resolve(specExample));

  expect(outline()).toEqual(specOutline);
  expect(screen.getByRole('status')).toHaveTextContent(
    messages.summary('Lab', 7),
  );

  await searchFor(user, 'Exam');
  await settle(() =>
    calls[1].reject(new TreeSearchError('service', { status: 500 })),
  );

  expect(screen.getByRole('alert')).toHaveTextContent(messages.errors.service);
  const tree = screen.getByRole('group', { name: messages.treeLabel });
  expect(
    within(tree).getByText(messages.previousResults('Lab')),
  ).toBeInTheDocument();
  expect(outline()).toEqual(specOutline);

  await user.click(screen.getByRole('button', { name: messages.tryAgain }));

  expect(calls.map((call) => call.query)).toEqual(['Lab', 'Exam', 'Exam']);

  await settle(() => calls[2].resolve(examItems));

  expect(outline()).toEqual(examOutline);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(messages.previousResults('Lab'))).toBeNull();
});

it('shows the rejected copy and no Try again for a 400', async () => {
  const { client, calls } = createFakeClient();
  const user = userEvent.setup();
  render(<App client={client} />);

  await searchFor(user, 'error');
  await settle(() =>
    calls[0].reject(new TreeSearchError('invalid-query', { status: 400 })),
  );

  expect(screen.getByRole('alert')).toHaveTextContent(
    messages.errors['invalid-query'],
  );
  expect(screen.queryByRole('button', { name: messages.tryAgain })).toBeNull();
});

it('shows the second search when it beats a slow first one, and the late first result leaves it', async () => {
  const { client, calls } = createFakeClient();
  const user = userEvent.setup();
  render(<App client={client} />);

  await searchFor(user, 'Lab');
  await searchFor(user, 'Exam');
  await settle(() => calls[1].resolve(examItems));

  expect(outline()).toEqual(examOutline);
  expect(screen.getByRole('status')).toHaveTextContent(
    messages.summary('Exam', 2),
  );

  await settle(() => calls[0].resolve(specExample));

  expect(outline()).toEqual(examOutline);
  expect(screen.getByRole('status')).toHaveTextContent(
    messages.summary('Exam', 2),
  );
});

it('shows noResults and no tree for an empty list', async () => {
  const { client, calls } = createFakeClient();
  const user = userEvent.setup();
  render(<App client={client} />);

  await searchFor(user, 'Lab');
  await settle(() => calls[0].resolve([]));

  expect(screen.getByRole('status')).toHaveTextContent(
    messages.noResults('Lab'),
  );
  expect(screen.queryByRole('group', { name: messages.treeLabel })).toBeNull();
  expect(outline()).toEqual([]);
});

it("recovers through the real client from a 504 HTML page to the brief's outline", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('<html><h1>504 Gateway Time-out</h1></html>', {
        status: 504,
        headers: { 'content-type': 'text/html' },
      }),
    )
    .mockResolvedValueOnce(Response.json(specExample));
  const client = createHttpSearchClient({ baseUrl: '/api', fetchImpl });
  const user = userEvent.setup();
  render(<App client={client} />);

  await searchFor(user, 'Lab');

  expect(await screen.findByRole('alert')).toHaveTextContent(
    messages.errors.service,
  );
  expect(outline()).toEqual([]);

  await user.click(screen.getByRole('button', { name: messages.tryAgain }));

  expect(
    (await screen.findAllByTestId('tree-row')).map((row) => row.textContent),
  ).toEqual(specOutline);
  expect(screen.getByRole('status')).toHaveTextContent(
    messages.summary('Lab', 7),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fetchImpl.mock.calls.map(([input]) => input)).toEqual([
    '/api/?query=Lab',
    '/api/?query=Lab',
  ]);
});
