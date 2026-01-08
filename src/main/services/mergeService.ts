import type { GitLabClient } from "./gitlabClient";
import type { ConflictHandler, MergePair, MergeResult } from "./mergeTypes";
import { runAtomicBatchMergeByMerge } from "./mergeStrategies/merge";

export class MergeService {
  constructor(private client: GitLabClient) {}

  async runAtomicBatchMerge(
    projectId: number,
    pairs: MergePair[],
    opts?: {
      onLog?: (msg: string, error?: boolean) => void;
      conflictHandler?: ConflictHandler;
    }
  ): Promise<MergeResult> {
    return await runAtomicBatchMergeByMerge(this.client, projectId, pairs, {
      onLog: opts?.onLog,
      conflictHandler: opts?.conflictHandler,
    });
  }
}

export type { MergePair, MergeResult } from "./mergeTypes";
