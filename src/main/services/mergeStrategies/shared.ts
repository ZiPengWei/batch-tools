import type { GitLabClient } from "../gitlabClient";
import type { GitLabMergeRequest } from "../../../shared/gitlab/types";
import type {
  MergeConflict,
  MergeCreated,
  MergeNoop,
  MergeResult,
} from "../mergeTypes";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type LogFn = (msg: string, error?: boolean) => void;

export async function waitUntilMergeable(
  client: GitLabClient,
  projectId: number,
  mrIid: number,
  opts?: {
    maxRetries?: number;
    pollIntervalMs?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<
  | { ok: true; details: GitLabMergeRequest }
  | { ok: false; details?: GitLabMergeRequest; reason: string }
> {
  const maxRetries = opts?.maxRetries ?? 18;
  const pollIntervalMs = opts?.pollIntervalMs ?? 1500;

  let lastDetails: GitLabMergeRequest | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(pollIntervalMs);
    const details = await client.getMergeRequest(projectId, mrIid);
    lastDetails = details;

    const status = details.merge_status;
    const detailed = details.detailed_merge_status;
    const hasConflicts = details.has_conflicts;
    const state = details.state;

    const extra: string[] = [];
    if (detailed) extra.push(`detailed=${detailed}`);
    if (hasConflicts != null) extra.push(`has_conflicts=${String(hasConflicts)}`);
    const extraText = extra.length ? ` (${extra.join(", ")})` : "";
    opts?.onProgress?.(
      `  [MR !${mrIid}] 检测 ${attempt + 1}/${maxRetries}: status=${status}, state=${state}${extraText}`
    );

    if (state === "merged" || state === "closed")
      return { ok: false, details, reason: `MR 已处于 ${state}` };

    const changesCount = details.changes_count;
    if (
      detailed === "not_needed" ||
      detailed === "nothing_to_merge" ||
      changesCount === "0" ||
      changesCount === 0
    ) {
      const changesData = await client.getMergeRequestChanges(projectId, mrIid);
      const changes = changesData?.changes ?? [];
      if (!changes.length) return { ok: false, details, reason: "__noop_no_changes__" };
    }

    if (status === "can_be_merged" && !hasConflicts) return { ok: true, details };

    if (
      status === "cannot_be_merged" ||
      hasConflicts ||
      detailed === "cannot_be_merged" ||
      detailed === "conflicts"
    ) {
      const changesData = await client.getMergeRequestChanges(projectId, mrIid);
      const changes = changesData?.changes ?? [];
      if (!changes.length) return { ok: false, details, reason: "__noop_no_changes__" };
      return { ok: false, details, reason: "检测到冲突（不可合并）" };
    }
  }
  return {
    ok: false,
    details: lastDetails,
    reason: "超时：无法确认是否可合并",
  };
}

export async function waitUntilMerged(
  client: GitLabClient,
  projectId: number,
  mrIid: number,
  opts?: {
    maxRetries?: number;
    pollIntervalMs?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<
  | { ok: true; details: GitLabMergeRequest }
  | { ok: false; details?: GitLabMergeRequest; reason: string }
> {
  const maxRetries = opts?.maxRetries ?? 30;
  const pollIntervalMs = opts?.pollIntervalMs ?? 2000;

  let lastDetails: GitLabMergeRequest | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(pollIntervalMs);
    const details = await client.getMergeRequest(projectId, mrIid);
    lastDetails = details;
    const state = details.state;
    if (state === "merged") return { ok: true, details };
    if (state === "closed") return { ok: false, details, reason: "MR 已被关闭" };
    opts?.onProgress?.(`  [MR !${mrIid}] 等待合并 ${attempt + 1}/${maxRetries}: state=${state}`);
  }
  return {
    ok: false,
    details: lastDetails,
    reason: "超时：合并未完成（可能在等待 pipeline/审批）",
  };
}

export async function rollback(
  client: GitLabClient,
  projectId: number,
  created: MergeCreated[],
  noop: MergeNoop[],
  conflicts: MergeConflict[],
  log?: LogFn
): Promise<MergeResult> {
  log?.("=== 触发回滚 (Atomic Rollback) ===", true);
  for (const c of created) {
    const iid = c.mr.iid;
    if (!iid) continue;
    log?.(`正在清理 MR #${iid} ...`);
    await client.deleteMergeRequest(projectId, iid);
  }
  log?.("回滚完成。", true);
  return { ok: false, rolledBack: true, conflicts, noop };
}

