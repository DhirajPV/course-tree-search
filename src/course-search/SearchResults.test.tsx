import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SearchResults, messages } from './SearchResults';
import type { TreeNode } from './types';
import type { State, Status } from './useCourseSearch';

const labRoots: TreeNode[] = [
  {
    id: 1,
    name: 'Lab Experiment 1',
    children: [{ id: 3, name: 'Surface Chemistry', children: [] }],
  },
];
const labResult = { query: 'Lab', roots: labRoots };

function renderResults(state: State) {
  const onRetry = vi.fn<() => void>();
  render(<SearchResults state={state} onRetry={onRetry} />);
  return { onRetry };
}

it.each<{ label: string; status: Status }>([
  {
    label: 'is loading',
    status: { kind: 'loading', query: 'Exam', requestId: 2 },
  },
  {
    label: 'has failed',
    status: { kind: 'error', query: 'Exam', requestId: 2, code: 'service' },
  },
])(
  'shows the attribution line over the “Lab” tree while “Exam” $label',
  ({ status }) => {
    renderResults({ status, lastResult: labResult });

    const tree = screen.getByRole('group', { name: messages.treeLabel });
    const attribution = within(tree).getByText(messages.previousResults('Lab'));
    const [topLevel] = within(tree).getAllByRole('list');

    expect(
      attribution.compareDocumentPosition(topLevel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(tree)
        .getAllByTestId('tree-row')
        .map((row) => row.textContent),
    ).toEqual(['Lab Experiment 1', '- Surface Chemistry']);
  },
);

it('shows no attribution line while the tree belongs to the current query', () => {
  renderResults({
    status: { kind: 'loading', query: 'Lab', requestId: 2 },
    lastResult: labResult,
  });

  expect(
    screen.getByRole('group', { name: messages.treeLabel }),
  ).toBeInTheDocument();
  expect(screen.queryByText(messages.previousResults('Lab'))).toBeNull();
});

it('offers Try again for a service error', async () => {
  const user = userEvent.setup();
  const { onRetry } = renderResults({
    status: { kind: 'error', query: 'Exam', requestId: 1, code: 'service' },
    lastResult: null,
  });

  expect(screen.getByRole('alert')).toHaveTextContent(messages.errors.service);

  await user.click(screen.getByRole('button', { name: messages.tryAgain }));

  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('offers no Try again for an invalid query', () => {
  renderResults({
    status: {
      kind: 'error',
      query: 'error',
      requestId: 1,
      code: 'invalid-query',
    },
    lastResult: null,
  });

  expect(screen.getByRole('alert')).toHaveTextContent(
    messages.errors['invalid-query'],
  );
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows only the alert when the previous result was empty', () => {
  renderResults({
    status: { kind: 'error', query: 'Exam', requestId: 2, code: 'service' },
    lastResult: { query: 'Lab', roots: [] },
  });

  expect(screen.getByRole('alert')).toHaveTextContent(messages.errors.service);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.queryByRole('group', { name: messages.treeLabel })).toBeNull();
  expect(screen.queryByText(messages.previousResults('Lab'))).toBeNull();
  expect(screen.queryAllByTestId('tree-row')).toEqual([]);
});
