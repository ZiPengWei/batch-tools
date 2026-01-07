import type { GitLabClient } from "./gitlabClient";
import type { MergePair, MergeResult } from "./mergeTypes";
import { runAtomicBatchMergeByMerge } from "./mergeStrategies/merge";

export class MergeService {
  constructor(private client: GitLabClient) {}

  async runAtomicBatchMerge(
    projectId: number,
    pairs: MergePair[],
    opts?: {
      onLog?: (msg: string, error?: boolean) => void;
    }
  ): Promise<MergeResult> {
    return await runAtomicBatchMergeByMerge(this.client, projectId, pairs, {
      onLog: opts?.onLog,
    });
  }
}

export type { MergePair, MergeResult } from "./mergeTypes";
