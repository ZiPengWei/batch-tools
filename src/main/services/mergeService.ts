import { GitLabClient } from "./gitlabClient";
import type { GitLabMergeRequest } from "../../shared/gitlab/types";

export type MergePair = { source: string; target: string };

export type MergeNoop = {
  type: "noop";
  source: string;
  target: string;
  reason: string;
  mrIid?: number;
};

export type MergeConflict = {
  type: "conflict";
  source: string;
  target: string;
  reason: string;
  mrIid?: number;
  mrWebUrl?: string;
  conflicts?: any[];
};

export type MergeCreated = {
  type: "created";
  source: string;
  target: string;
  mr: GitLabMergeRequest;
};

export type MergeResult =
  | { ok: true; mergedIids: number[]; noop: MergeNoop[] }
  | {
      ok: false;
      rolledBack: boolean;
      conflicts: MergeConflict[];
      noop: MergeNoop[];
    };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class MergeService {
  constructor(private client: GitLabClient) {}

  async waitUntilMergeable(
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
      const details = await this.client.getMergeRequest(projectId, mrIid);
      lastDetails = details;

      const status = details.merge_status;
      const detailed = details.detailed_merge_status;
      const hasConflicts = details.has_conflicts;
      const state = details.state;

      const extra: string[] = [];
      if (detailed) extra.push(`detailed=${detailed}`);
      if (hasConflicts != null)
        extra.push(`has_conflicts=${String(hasConflicts)}`);
      const extraText = extra.length ? ` (${extra.join(", ")})` : "";
      opts?.onProgress?.(
        `  [MR !${mrIid}] 检测 ${
          attempt + 1
        }/${maxRetries}: status=${status}, state=${state}${extraText}`
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
        const changesData = await this.client.getMergeRequestChanges(
          projectId,
          mrIid
        );
        const changes = changesData?.changes ?? [];
        if (!changes.length)
          return { ok: false, details, reason: "__noop_no_changes__" };
      }

      if (status === "can_be_merged" && !hasConflicts)
        return { ok: true, details };

      if (
        status === "cannot_be_merged" ||
        hasConflicts ||
        detailed === "cannot_be_merged" ||
        detailed === "conflicts"
      ) {
        const changesData = await this.client.getMergeRequestChanges(
          projectId,
          mrIid
        );
        const changes = changesData?.changes ?? [];
        if (!changes.length)
          return { ok: false, details, reason: "__noop_no_changes__" };
        return { ok: false, details, reason: "检测到冲突（不可合并）" };
      }
    }
    return {
      ok: false,
      details: lastDetails,
      reason: "超时：无法确认是否可合并",
    };
  }

  async waitUntilMerged(
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
      const details = await this.client.getMergeRequest(projectId, mrIid);
      lastDetails = details;
      const state = details.state;
      if (state === "merged") return { ok: true, details };
      if (state === "closed")
        return { ok: false, details, reason: "MR 已被关闭" };
      opts?.onProgress?.(
        `  [MR !${mrIid}] 等待合并 ${attempt + 1}/${maxRetries}: state=${state}`
      );
    }
    return {
      ok: false,
      details: lastDetails,
      reason: "超时：合并未完成（可能在等待 pipeline/审批）",
    };
  }

  async runAtomicBatchMerge(
    projectId: number,
    pairs: MergePair[],
    opts?: { onLog?: (msg: string, error?: boolean) => void }
  ): Promise<MergeResult> {
    const created: MergeCreated[] = [];
    const noop: MergeNoop[] = [];
    const conflicts: MergeConflict[] = [];

    const log = (m: string, e?: boolean) => opts?.onLog?.(m, e);

    for (const { source, target } of pairs) {
      if (source === target) {
        noop.push({ type: "noop", source, target, reason: "source == target" });
        continue;
      }
      log?.(`正在创建 MR: ${source} -> ${target} ...`);
      const mr = await this.client.createMergeRequest(
        projectId,
        source,
        target,
        `Merge ${source} into ${target} [Batch Tool]`
      );
      if ((mr as any).status === "error") {
        conflicts.push({
          type: "conflict",
          source,
          target,
          reason: (mr as any).message || "创建失败",
        });
        log?.(`创建失败: ${(mr as any).message}`, true);
        return await this.rollback(projectId, created, noop, conflicts, log);
      }
      if ((mr as any).status === "noop") {
        noop.push({
          type: "noop",
          source,
          target,
          reason: (mr as any).message || "无变更",
        });
        log?.(`无需合并（无变更）: ${source} -> ${target}`);
        continue;
      }
      created.push({
        type: "created",
        source,
        target,
        mr: mr as GitLabMergeRequest,
      });
      log?.(`MR Created: IID ${(mr as GitLabMergeRequest).iid}`);
    }

    log?.("=== 阶段 2：检测所有 MR 是否可合并 ===");
    for (const c of created) {
      const iid = c.mr.iid;
      if (!iid) continue;
      const check = await this.waitUntilMergeable(projectId, iid, {
        onProgress: (m) => log?.(m),
      });
      if (check.ok) {
        log?.(`可合并: ${c.source} -> ${c.target} (MR !${iid})`);
        continue;
      }
      if (check.reason === "__noop_no_changes__") {
        noop.push({
          type: "noop",
          source: c.source,
          target: c.target,
          reason: "无变更",
          mrIid: iid,
        });
        try {
          await this.client.deleteMergeRequest(projectId, iid);
        } catch {}
        c.mr.iid = undefined;
        continue;
      }

      const conflictList = await this.client.getMergeRequestConflicts(
        projectId,
        iid
      );
      conflicts.push({
        type: "conflict",
        source: c.source,
        target: c.target,
        reason: check.reason,
        mrIid: iid,
        mrWebUrl: (check.details as any)?.web_url,
        conflicts: conflictList,
      });
      log?.(
        `不可合并: ${c.source} -> ${c.target} (MR !${iid}) - ${check.reason}`,
        true
      );
      return await this.rollback(projectId, created, noop, conflicts, log);
    }

    log?.("=== 阶段 3：执行真实合并 ===");
    const mergedIids: number[] = [];
    const failed: Array<{
      iid: number;
      source: string;
      target: string;
      reason: string;
    }> = [];

    for (const c of created) {
      const iid = c.mr.iid;
      if (!iid) continue;
      log?.(`请求合并: ${c.source} -> ${c.target} (MR !${iid})`);
      try {
        await this.client.acceptMergeRequest(projectId, iid);
        const wait = await this.waitUntilMerged(projectId, iid, {
          onProgress: (m) => log?.(m),
        });
        if (wait.ok) {
          mergedIids.push(iid);
          log?.(`已合并: ${c.source} -> ${c.target} (MR !${iid})`);
        } else {
          failed.push({
            iid,
            source: c.source,
            target: c.target,
            reason: wait.reason,
          });
          log?.(
            `合并未完成: ${c.source} -> ${c.target} (MR !${iid}) - ${wait.reason}`,
            true
          );
        }
      } catch (e) {
        failed.push({
          iid,
          source: c.source,
          target: c.target,
          reason: String(e),
        });
        log?.(
          `合并调用失败: ${c.source} -> ${c.target} (MR !${iid}) - ${String(
            e
          )}`,
          true
        );
      }
    }

    if (failed.length) {
      for (const f of failed) {
        try {
          await this.client.updateMergeRequest(projectId, f.iid, "close");
        } catch {}
      }
      conflicts.push(
        ...failed.map((f) => ({
          type: "conflict" as const,
          source: f.source,
          target: f.target,
          reason: f.reason,
          mrIid: f.iid,
        }))
      );
      return { ok: false, rolledBack: false, conflicts, noop };
    }

    return { ok: true, mergedIids, noop };
  }

  private async rollback(
    projectId: number,
    created: MergeCreated[],
    noop: MergeNoop[],
    conflicts: MergeConflict[],
    log?: (m: string, e?: boolean) => void
  ): Promise<MergeResult> {
    log?.("=== 触发回滚 (Atomic Rollback) ===", true);
    for (const c of created) {
      const iid = c.mr.iid;
      if (!iid) continue;
      log?.(`正在清理 MR #${iid} ...`);
      await this.client.deleteMergeRequest(projectId, iid);
    }
    log?.("回滚完成。", true);
    return { ok: false, rolledBack: true, conflicts, noop };
  }
}
