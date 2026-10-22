export type MergePair = { source: string; target: string };

export type MergeNoop = {
  type: "noop";
  source: string;
  target: string;
  reason: string;
};

export type MergeConflict = {
  type: "conflict";
  source: string;
  target: string;
  reason: string;
  prNumber?: string;
};

export type MergeFailure = {
  type: "failure";
  source: string;
  target: string;
  reason: string;
  prNumber?: string;
};

export type MergeMerged = {
  type: "merged";
  source: string;
  target: string;
  prNumber?: string;
};

/**
 * 批量合并结果：
 * - merged: 成功合并的分支对
 * - conflicts: 检测到冲突被跳过（PR 已取消）的分支对
 * - noop: 无变更跳过的分支对
 * - failures: 其他原因失败的分支对
 * - ok: 仅当没有冲突且没有失败时为 true
 */
export type MergeResult = {
  ok: boolean;
  merged: MergeMerged[];
  conflicts: MergeConflict[];
  noop: MergeNoop[];
  failures: MergeFailure[];
};
