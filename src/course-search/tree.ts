import type { CourseItem, DataIssue, TreeNode } from './types';

export function buildTree(items: readonly CourseItem[]): {
  roots: TreeNode[];
  issues: DataIssue[];
} {
  const firstById = new Map<number, CourseItem>();
  const conflictingIds = new Set<number>();
  for (const item of items) {
    const first = firstById.get(item.id);
    if (first === undefined) {
      firstById.set(item.id, item);
    } else if (first.name !== item.name || first.parent_id !== item.parent_id) {
      conflictingIds.add(item.id);
    }
  }

  // Response order is arbitrary while ids follow the authored order, so
  // grouping in id order leaves the roots and every sibling list sorted.
  const ordered = [...firstById.values()].sort((a, b) => a.id - b.id);
  const rootItems: CourseItem[] = [];
  const childItems = new Map<number, CourseItem[]>();
  for (const item of ordered) {
    if (item.parent_id === 0 || !firstById.has(item.parent_id)) {
      rootItems.push(item);
      continue;
    }
    const siblings = childItems.get(item.parent_id);
    if (siblings === undefined) {
      childItems.set(item.parent_id, [item]);
    } else {
      siblings.push(item);
    }
  }

  // Nodes are created only when reached from a root, so a cycle is never
  // linked into the output; what is left over is the cycle and all beneath it.
  const roots: TreeNode[] = [];
  const reached = new Set<number>();
  const stack: TreeNode[] = [];
  const addNode = (item: CourseItem, siblings: TreeNode[]) => {
    const node: TreeNode = { id: item.id, name: item.name, children: [] };
    siblings.push(node);
    stack.push(node);
    reached.add(item.id);
  };
  for (const item of rootItems) {
    addNode(item, roots);
  }
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    for (const child of childItems.get(node.id) ?? []) {
      addNode(child, node.children);
    }
  }

  const issues = [...conflictingIds]
    .sort((a, b) => a - b)
    .map((id): DataIssue => ({ kind: 'duplicate-id', id }));
  const unreachable = ordered
    .filter((item) => !reached.has(item.id))
    .map((item) => item.id);
  if (unreachable.length > 0) {
    issues.push({ kind: 'cycle', affectedIds: unreachable });
  }

  return { roots, issues };
}

export function prefixFor(depth: number): string {
  return '- '.repeat(depth);
}

export function formatOutline(roots: readonly TreeNode[]): string {
  const lines: string[] = [];
  const stack: { node: TreeNode; depth: number }[] = [];
  // Pushed last-to-first so the first sibling is the next one popped.
  const pushAll = (nodes: readonly TreeNode[], depth: number) => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      stack.push({ node: nodes[index], depth });
    }
  };

  pushAll(roots, 0);
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    lines.push(prefixFor(entry.depth) + entry.node.name);
    pushAll(entry.node.children, entry.depth + 1);
  }
  return lines.join('\n');
}

export function descendantCount(node: TreeNode): number {
  let count = 0;
  const stack = [...node.children];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    count += 1;
    for (const child of next.children) {
      stack.push(child);
    }
  }
  return count;
}
