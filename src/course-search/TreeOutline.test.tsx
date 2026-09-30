import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TreeOutline } from './TreeOutline';
import { formatOutline } from './tree';
import type { TreeNode } from './types';

const roots: TreeNode[] = [
  {
    id: 1,
    name: 'Lab Experiment 1',
    children: [
      {
        id: 3,
        name: 'Surface Chemistry',
        children: [
          { id: 2, name: 'Colloidal Solution (sol) of Starch', children: [] },
          { id: 7, name: 'Colloidal Solution of Gum', children: [] },
        ],
      },
      { id: 4, name: 'Lab 1 Summary', children: [] },
    ],
  },
  {
    id: 6,
    name: 'Lab Experiment 2',
    children: [{ id: 5, name: 'Chemical Kinetics', children: [] }],
  },
];

it('nests a child ul inside its parent li', () => {
  render(<TreeOutline roots={roots} />);

  const parentItem = screen.getByText('Surface Chemistry').closest('li');
  expect(parentItem).not.toBeNull();
  const childList = within(parentItem!).getByRole('list');

  expect(childList.tagName).toBe('UL');
  expect(childList.parentElement).toBe(parentItem);
  expect(Array.from(childList.children).map((child) => child.tagName)).toEqual([
    'LI',
    'LI',
  ]);
  expect(childList).toHaveTextContent('Colloidal Solution (sol) of Starch');
  expect(childList).toHaveTextContent('Colloidal Solution of Gum');
});

it('gives every list an explicit list role', () => {
  const { container } = render(<TreeOutline roots={roots} />);

  const lists = Array.from(container.querySelectorAll('ul'));

  expect(lists).toHaveLength(4);
  for (const list of lists) {
    expect(list).toHaveAttribute('role', 'list');
  }
});

it("renders each row as formatOutline's line for it", () => {
  render(<TreeOutline roots={roots} />);

  const rows = screen.getAllByTestId('tree-row');

  expect(rows.map((row) => row.textContent)).toEqual(
    formatOutline(roots).split('\n'),
  );
});
