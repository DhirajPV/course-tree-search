export interface CourseItem {
  id: number;
  name: string;
  parent_id: number;
}

export interface TreeNode {
  id: number;
  name: string;
  children: TreeNode[];
}

export type DataIssue =
  | { kind: 'duplicate-id'; id: number }
  | { kind: 'cycle'; affectedIds: number[] };

export type SearchErrorCode =
  | 'invalid-query'
  | 'service'
  | 'network'
  | 'timeout'
  | 'invalid-response'
  | 'unusable-data'
  | 'unknown';
