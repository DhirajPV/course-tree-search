import { prefixFor } from './tree';
import type { TreeNode } from './types';

function TreeLevel({
  nodes,
  depth,
}: {
  nodes: readonly TreeNode[];
  depth: number;
}) {
  return (
    // Safari removes list semantics from a list styled without markers, so
    // the role is stated even though it is the element's own.
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <ul className="tree-level" role="list">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="tree-row" data-testid="tree-row">
            {/* The nested lists already carry the depth for assistive tech. */}
            <span className="tree-prefix" aria-hidden="true">
              {prefixFor(depth)}
            </span>
            <span className="tree-name">{node.name}</span>
          </div>
          {node.children.length > 0 && (
            <TreeLevel nodes={node.children} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function TreeOutline({ roots }: { roots: readonly TreeNode[] }) {
  return <TreeLevel nodes={roots} depth={0} />;
}
