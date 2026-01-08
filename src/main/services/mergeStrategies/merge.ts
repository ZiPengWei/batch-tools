import type { GitLabClient } from "../gitlabClient";
import type {
  ConflictHandler,
  MergeConflict,
  MergeCreated,
  MergeNoop,
  MergePair,
  MergeResult,
} from "../mergeTypes";
import {
  rollback,
  waitUntilMergeable,
  waitUntilMerged,
  type LogFn,
} from "./shared";

// merge 模式：保持现有行为（创建 MR -> 可合并检测 -> 接口触发合并 -> 等待合并完成）
export async function runAtomicBatchMergeByMerge(
  client: GitLabClient,
  projectId: number,
  pairs: MergePair[],
  opts?: { onLog?: LogFn; conflictHandler?: ConflictHandler }
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
    const mr = await client.createMergeRequest(
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
      return await rollback(client, projectId, created, noop, conflicts, log);
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
      mr: mr as any,
    });
    log?.(`MR Created: IID ${(mr as any).iid}`);
  }

  log?.("=== 阶段 2：检测所有 MR 是否可合并 ===");
  for (const c of created) {
    const iid = c.mr.iid;
    if (!iid) continue;
    const check = await waitUntilMergeable(client, projectId, iid, {
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
        await client.deleteMergeRequest(projectId, iid);
      } catch {}
      c.mr.iid = undefined;
      continue;
    }

    const conflictList = await client.getMergeRequestConflicts(projectId, iid);

    if (opts?.conflictHandler) {
      log?.(
        `检测到冲突: ${c.source} -> ${c.target} (MR !${iid})，等待用户解决...`
      );
      try {
        const resolution = await opts.conflictHandler({
          projectId,
          mrIid: iid,
          source: c.source,
          target: c.target,
          conflicts: conflictList,
        });
        if (resolution.resolved) {
          log?.(`用户标记冲突已解决，重新检测可合并状态...`);
          const recheck = await waitUntilMergeable(client, projectId, iid, {
            onProgress: (m) => log?.(m),
          });
          if (recheck.ok) {
            log?.(`冲突已解决且 MR 可合并: ${c.source} -> ${c.target}`);
            continue;
          } else {
            log?.(`重新检测失败: ${recheck.reason}`, true);
          }
        } else {
          log?.(`用户取消或未解决冲突`);
        }
      } catch (e) {
        log?.(`冲突处理出错: ${e}`, true);
      }
    }

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
    return await rollback(client, projectId, created, noop, conflicts, log);
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
      await client.acceptMergeRequest(projectId, iid);
      const wait = await waitUntilMerged(client, projectId, iid, {
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
        `合并调用失败: ${c.source} -> ${c.target} (MR !${iid}) - ${String(e)}`,
        true
      );
    }
  }

  if (failed.length) {
    for (const f of failed) {
      try {
        await client.updateMergeRequest(projectId, f.iid, "close");
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
