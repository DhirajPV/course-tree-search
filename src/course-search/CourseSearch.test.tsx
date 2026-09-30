import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { CourseSearch } from './CourseSearch';
import { messages } from './SearchResults';
import { TreeSearchError, type SearchClient } from './client';

function pendingSearch() {
  return vi.fn<SearchClient['search']>(() => new Promise(() => {}));
}

it('keeps the form disabled while the term is blank or only whitespace', async () => {
  const search = pendingSearch();
  const user = userEvent.setup();
  render(<CourseSearch client={{ search }} />);
  const input = screen.getByRole('searchbox', { name: messages.searchLabel });
  const button = screen.getByRole('button', { name: messages.searchButton });

  expect(button).toBeDisabled();

  await user.type(input, '   {Enter}');
  // Enter cannot submit past a disabled button; a direct submit event can.
  fireEvent.submit(screen.getByRole('search'));

  expect(button).toBeDisabled();
  expect(search).not.toHaveBeenCalled();

  await user.type(input, 'Lab');

  expect(button).toBeEnabled();
});

it('submits the trimmed term on Enter', async () => {
  const search = pendingSearch();
  const user = userEvent.setup();
  render(<CourseSearch client={{ search }} />);

  await user.type(
    screen.getByRole('searchbox', { name: messages.searchLabel }),
    '  Lab  {Enter}',
  );

  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0][0]).toBe('Lab');
  expect(screen.getByRole('status')).toHaveTextContent(
    messages.searching('Lab'),
  );
});

it('moves focus to the search input when Try again is clicked', async () => {
  const client: SearchClient = {
    search: () =>
      Promise.reject(new TreeSearchError('service', { status: 503 })),
  };
  const user = userEvent.setup();
  render(<CourseSearch client={client} />);
  const input = screen.getByRole('searchbox', { name: messages.searchLabel });

  await user.type(input, 'Module');
  await user.click(screen.getByRole('button', { name: messages.searchButton }));
  await user.click(
    await screen.findByRole('button', { name: messages.tryAgain }),
  );

  expect(input).toHaveFocus();
  // The retry fails too; its alert must not take the focus back.
  await screen.findByRole('button', { name: messages.tryAgain });
  expect(input).toHaveFocus();
});
