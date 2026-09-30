import { describe, expect, it } from 'vitest';
import { buildTree, descendantCount, formatOutline, prefixFor } from './tree';
import type { CourseItem } from './types';

const item = (id: number, name: string, parent_id: number): CourseItem => ({
  id,
  name,
  parent_id,
});

const outlineOf = (items: readonly CourseItem[]) =>
  formatOutline(buildTree(items).roots).split('\n');

const specExample: CourseItem[] = [
  { id: 5, name: 'Chemical Kinetics', parent_id: 6 },
  { id: 3, name: 'Surface Chemistry', parent_id: 1 },
  { id: 1, name: 'Lab Experiment 1', parent_id: 0 },
  { id: 4, name: 'Lab 1 Summary', parent_id: 1 },
  { id: 2, name: 'Colloidal Solution (sol) of Starch', parent_id: 3 },
  { id: 6, name: 'Lab Experiment 2', parent_id: 0 },
  { id: 7, name: 'Colloidal Solution of Gum', parent_id: 3 },
];

describe('buildTree and formatOutline', () => {
  it("turns the brief's example into exactly its seven lines", () => {
    const { roots, issues } = buildTree(specExample);

    expect(issues).toEqual([]);
    expect(formatOutline(roots)).toBe(
      [
        'Lab Experiment 1',
        '- Surface Chemistry',
        '- - Colloidal Solution (sol) of Starch',
        '- - Colloidal Solution of Gum',
        '- Lab 1 Summary',
        'Lab Experiment 2',
        '- Chemical Kinetics',
      ].join('\n'),
    );
  });

  it('builds nodes of id, name and children, without parent_id', () => {
    expect(buildTree(specExample).roots).toEqual([
      {
        id: 1,
        name: 'Lab Experiment 1',
        children: [
          {
            id: 3,
            name: 'Surface Chemistry',
            children: [
              {
                id: 2,
                name: 'Colloidal Solution (sol) of Starch',
                children: [],
              },
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
    ]);
  });

  it('puts shuffled sandbox questions back in order, 5.1 to 5.8', () => {
    const items: CourseItem[] = [
      { id: 92, name: 'Question 5.5', parent_id: 87 },
      { id: 88, name: 'Question 5.1', parent_id: 87 },
      { id: 95, name: 'Question 5.8', parent_id: 87 },
      { id: 87, name: 'Slides', parent_id: 85 },
      { id: 90, name: 'Question 5.3', parent_id: 87 },
      { id: 94, name: 'Question 5.7', parent_id: 87 },
      { id: 85, name: 'Module 5', parent_id: 0 },
      { id: 89, name: 'Question 5.2', parent_id: 87 },
      { id: 93, name: 'Question 5.6', parent_id: 87 },
      { id: 91, name: 'Question 5.4', parent_id: 87 },
    ];

    const { roots, issues } = buildTree(items);

    expect(issues).toEqual([]);
    expect(formatOutline(roots).split('\n')).toEqual([
      'Module 5',
      '- Slides',
      '- - Question 5.1',
      '- - Question 5.2',
      '- - Question 5.3',
      '- - Question 5.4',
      '- - Question 5.5',
      '- - Question 5.6',
      '- - Question 5.7',
      '- - Question 5.8',
    ]);
  });

  it('returns no roots and no issues for an empty list', () => {
    expect(buildTree([])).toEqual({ roots: [], issues: [] });
    expect(formatOutline([])).toBe('');
  });

  it('places children that arrive before their parents', () => {
    const items = [
      item(3, 'Question 1.1', 2),
      item(2, 'Slides', 1),
      item(1, 'Module 1', 0),
    ];

    expect(buildTree(items).issues).toEqual([]);
    expect(outlineOf(items)).toEqual([
      'Module 1',
      '- Slides',
      '- - Question 1.1',
    ]);
  });

  it('sorts the roots and every sibling list by ascending id', () => {
    // 9, 20 and 100 would come out as 100, 20, 9 if ids were compared as text.
    const items = [
      item(100, 'Module 100', 0),
      item(25, 'Slides 25', 20),
      item(9, 'Module 9', 0),
      item(14, 'Question 14', 11),
      item(12, 'Slides 12', 9),
      item(20, 'Module 20', 0),
      item(11, 'Slides 11', 9),
      item(21, 'Slides 21', 20),
      item(13, 'Question 13', 11),
    ];

    expect(outlineOf(items)).toEqual([
      'Module 9',
      '- Slides 11',
      '- - Question 13',
      '- - Question 14',
      '- Slides 12',
      'Module 20',
      '- Slides 21',
      '- Slides 25',
      'Module 100',
    ]);
  });

  it('puts an item whose parent is not in the list at the top level, with its children', () => {
    const items = [
      item(8, 'Question 7.1', 7),
      item(7, 'Slides', 99),
      item(1, 'Module 1', 0),
    ];

    expect(buildTree(items).issues).toEqual([]);
    expect(outlineOf(items)).toEqual(['Module 1', 'Slides', '- Question 7.1']);
  });

  it('keeps parent_id 0 at the top level when an item with id 0 exists', () => {
    const items = [
      item(2, 'Slides', 1),
      item(1, 'Module 1', 0),
      item(0, 'Preface', 0),
    ];

    expect(buildTree(items).issues).toEqual([]);
    expect(outlineOf(items)).toEqual(['Preface', 'Module 1', '- Slides']);
  });

  it('collapses identical duplicate rows without an issue', () => {
    const items = [
      item(1, 'Module 1', 0),
      item(2, 'Slides', 1),
      item(2, 'Slides', 1),
      item(1, 'Module 1', 0),
      item(2, 'Slides', 1),
    ];

    expect(buildTree(items).issues).toEqual([]);
    expect(outlineOf(items)).toEqual(['Module 1', '- Slides']);
  });

  it.each([
    ['a different name', item(2, 'Notes', 1)],
    ['a different parent', item(2, 'Slides', 3)],
  ])(
    'reports a duplicate id with %s and builds the rest',
    (_difference, conflicting) => {
      const items = [
        item(1, 'Module 1', 0),
        item(2, 'Slides', 1),
        conflicting,
        item(3, 'Module 3', 0),
        item(4, 'Question 3.1', 3),
      ];

      const { roots, issues } = buildTree(items);

      expect(issues).toEqual([{ kind: 'duplicate-id', id: 2 }]);
      expect(roots.map((root) => root.id)).toEqual([1, 3]);
      expect(roots[1].children).toContainEqual({
        id: 4,
        name: 'Question 3.1',
        children: [],
      });
    },
  );

  it('reports each conflicting id once, in ascending order', () => {
    const items = [
      item(7, 'Slides', 0),
      item(3, 'Module 3', 0),
      item(7, 'Notes', 0),
      item(3, 'Module three', 0),
      item(7, 'Handout', 0),
      item(7, 'Slides', 0),
    ];

    expect(buildTree(items).issues).toEqual([
      { kind: 'duplicate-id', id: 3 },
      { kind: 'duplicate-id', id: 7 },
    ]);
  });

  it('reports 2 -> 3 -> 2 and the child beneath it as one cycle issue, and builds the rest', () => {
    const items = [
      item(9, 'Beneath the cycle', 3),
      item(3, 'Points at 2', 2),
      item(1, 'Module 1', 0),
      item(2, 'Points at 3', 3),
    ];

    const { roots, issues } = buildTree(items);

    expect(issues).toEqual([{ kind: 'cycle', affectedIds: [2, 3, 9] }]);
    expect(roots).toEqual([{ id: 1, name: 'Module 1', children: [] }]);
  });

  it('adds a self-parent to the same cycle issue', () => {
    const items = [
      item(9, 'Beneath the cycle', 3),
      item(4, 'Its own parent', 4),
      item(3, 'Points at 2', 2),
      item(1, 'Module 1', 0),
      item(2, 'Points at 3', 3),
    ];

    expect(buildTree(items).issues).toEqual([
      { kind: 'cycle', affectedIds: [2, 3, 4, 9] },
    ]);
  });

  it('lists separate cycles in a single issue', () => {
    const items = [
      item(21, 'Loop B', 20),
      item(11, 'Loop A', 10),
      item(20, 'Loop B', 21),
      item(12, 'Loop A', 11),
      item(10, 'Loop A', 12),
    ];

    expect(buildTree(items)).toEqual({
      roots: [],
      issues: [{ kind: 'cycle', affectedIds: [10, 11, 12, 20, 21] }],
    });
  });

  it('reports a conflicting duplicate and a cycle from the same list', () => {
    const items = [
      item(1, 'Module 1', 0),
      item(1, 'Module one', 0),
      item(5, 'Its own parent', 5),
    ];

    const { issues } = buildTree(items);

    expect(issues).toHaveLength(2);
    expect(issues).toContainEqual({ kind: 'duplicate-id', id: 1 });
    expect(issues).toContainEqual({ kind: 'cycle', affectedIds: [5] });
  });

  it('builds a 5000-deep chain', () => {
    const depth = 5000;
    const items: CourseItem[] = [];
    for (let id = depth; id >= 1; id -= 1) {
      items.push(item(id, `Level ${id}`, id - 1));
    }

    const { roots, issues } = buildTree(items);

    // Walked by hand: a deep equality check would recurse once per level.
    let deepest = roots[0];
    let levels = 1;
    while (deepest.children.length > 0) {
      deepest = deepest.children[0];
      levels += 1;
    }
    expect(issues.length).toBe(0);
    expect(roots.length).toBe(1);
    expect(levels).toBe(depth);
    expect(deepest.id).toBe(depth);
    expect(descendantCount(roots[0])).toBe(depth - 1);
  });

  it('leaves a frozen input unchanged', () => {
    const items = Object.freeze(
      specExample.map((entry) => Object.freeze({ ...entry })),
    );

    expect(() => buildTree(items)).not.toThrow();
    expect(items).toEqual(specExample);
  });
});

describe('prefixFor', () => {
  it('repeats one hyphen and a space per level of depth', () => {
    expect(prefixFor(0)).toBe('');
    expect(prefixFor(1)).toBe('- ');
    expect(prefixFor(3)).toBe('- - - ');
  });
});

describe('descendantCount', () => {
  it("counts 4 and 1 beneath the roots of the brief's example", () => {
    const { roots } = buildTree(specExample);

    expect(roots.map(descendantCount)).toEqual([4, 1]);
  });

  it('counts nothing beneath a leaf', () => {
    expect(
      descendantCount({ id: 4, name: 'Lab 1 Summary', children: [] }),
    ).toBe(0);
  });
});
