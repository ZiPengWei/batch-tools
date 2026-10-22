import type { CnbClient } from "./cnbClient";
import type { MergePair, MergeResult } from "./mergeTypes";
import { runBatchMerge } from "./mergeStrategies/merge";

export class MergeService {
  constructor(private client: CnbClient) {}

  /**
   * 批量合并：每个目标分支独立处理。
   * 冲突 → 跳过并取消 PR；无冲突 → 直接合并。
   */
  async runBatchMerge(
    repo: string,
    pairs: MergePair[],
    opts?: {
      onLog?: (msg: string, error?: boolean) => void;
    }
  ): Promise<MergeResult> {
    return await runBatchMerge(this.client, repo, pairs, {
      onLog: opts?.onLog,
    });
  }
}

export type { MergePair, MergeResult } from "./mergeTypes";
