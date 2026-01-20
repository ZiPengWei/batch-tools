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

function normalizeConflictFiles(list: unknown): any[] {
  const raw = Array.isArray(list) ? list : [];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const anyIt = it as any;
    const p = String(
      anyIt.new_path ??
        anyIt.newPath ??
        anyIt.file_path ??
        anyIt.filePath ??
        anyIt.path ??
        anyIt.file ??
        ""
    ).trim();
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ ...anyIt, new_path: p });
  }
  return out;
}

function mergeConflictFiles(a: any[], b: any[]) {
  const map = new Map<string, any>();
  for (const it of normalizeConflictFiles(a)) {
    map.set(String(it.new_path), it);
  }
  for (const it of normalizeConflictFiles(b)) {
    const key = String(it.new_path);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, it);
      continue;
    }
    const merged: any = { ...prev };
    for (const [k, v] of Object.entries(it)) {
      if (v !== undefined) merged[k] = v;
    }
    map.set(key, merged);
  }
  return Array.from(map.values());
}

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

    let activeMr: any; // GitLabMergeRequest
    let isExistingMr = false;

    if ((mr as any).status === "error") {
      // 尝试查找已存在的 MR
      const existing = await client.findOpenMergeRequest(
        projectId,
        source,
        target
      );
      if (existing) {
        log?.(`检测到已存在的 MR !${existing.iid}，将使用该 MR 进行合并`);
        activeMr = existing;
        isExistingMr = true;
      } else {
        conflicts.push({
          type: "conflict",
          source,
          target,
          reason: (mr as any).message || "创建失败",
        });
        log?.(`创建失败: ${(mr as any).message}`, true);
        return await rollback(client, projectId, created, noop, conflicts, log);
      }
    } else if ((mr as any).status === "noop") {
      noop.push({
        type: "noop",
        source,
        target,
        reason: (mr as any).message || "无变更",
      });
      log?.(`无需合并（无变更）: ${source} -> ${target}`);
      continue;
    } else {
      activeMr = mr;
    }

    created.push({
      type: "created",
      source,
      target,
      mr: activeMr,
      isExisting: isExistingMr,
    });
    log?.(`MR Ready: IID ${activeMr.iid}`);
  }

  log?.("=== 阶段 2：检测所有 MR 是否可合并 ===");
  for (const c of created) {
    const iid = c.mr.iid;
    if (!iid) continue;
    const check = await waitUntilMergeable(client, projectId, iid, {
      onProgress: (m) => log?.(m),
      strictConflictCheck: true,
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

    let conflictApiDebug: any = null;
    let conflictList: any[] = [];
    try {
      conflictList = await client.getMergeRequestConflicts(
        projectId,
        iid,
        (info) => {
          conflictApiDebug = info;
          const parts: string[] = [];
          parts.push(`[冲突接口诊断] ${info.method} ${info.url}`);
          if (info.status != null) parts.push(`status=${String(info.status)}`);
          if (info.filesCount != null)
            parts.push(`filesCount=${String(info.filesCount)}`);
          if (info.bodyType) parts.push(`bodyType=${info.bodyType}`);
          if (info.error) parts.push(`error=${info.error.message}`);
          log?.(parts.join(" | "), Boolean(info.error));
          if (info.requestHeaders)
            log?.(
              `[冲突接口诊断] requestHeaders=${JSON.stringify(
                info.requestHeaders
              )}`,
              false
            );
          if (info.responseHeaders)
            log?.(
              `[冲突接口诊断] responseHeaders=${JSON.stringify(
                info.responseHeaders
              )}`,
              false
            );
          if (info.bodyKeys?.length)
            log?.(`[冲突接口诊断] bodyKeys=${info.bodyKeys.join(",")}`, false);
        }
      );
    } catch (e) {
      log?.(`[冲突接口诊断] 获取冲突列表失败: ${String(e)}`, true);
      conflictList = [];
    }

    if (c.mr.web_url) {
      try {
        let conflictApiDebugJson: any = null;
        const list = await client.getMergeRequestConflictsJsonByMrWebUrl(
          c.mr.web_url,
          iid,
          (info) => {
            conflictApiDebugJson = info;
            const parts: string[] = [];
            parts.push(
              `[冲突接口诊断] (conflicts.json) ${info.method} ${info.url}`
            );
            if (info.status != null)
              parts.push(`status=${String(info.status)}`);
            if (info.filesCount != null)
              parts.push(`filesCount=${String(info.filesCount)}`);
            if (info.bodyType) parts.push(`bodyType=${info.bodyType}`);
            if (info.structureValid != null)
              parts.push(`structureValid=${String(info.structureValid)}`);
            if (info.error) parts.push(`error=${info.error.message}`);
            log?.(parts.join(" | "), Boolean(info.error));
          }
        );
        if (list.length) {
          const before = conflictList.length;
          conflictList = mergeConflictFiles(conflictList, list);
          conflictApiDebug = conflictApiDebugJson
            ? {
                ...(conflictApiDebug || {}),
                conflictsJson: conflictApiDebugJson,
              }
            : conflictApiDebug;
          if (conflictList.length > before) {
            log?.(
              `已通过 conflicts.json 补全冲突文件：${before} -> ${conflictList.length}`,
              false
            );
          }
        } else if (conflictApiDebugJson) {
          conflictApiDebug = {
            ...(conflictApiDebug || {}),
            conflictsJson: conflictApiDebugJson,
          };
        }
      } catch (e) {
        log?.(`[冲突接口诊断] conflicts.json 回退失败: ${String(e)}`, true);
      }
    }

    if (!conflictList.length) {
      const hasConflicts = (check as any)?.details?.has_conflicts;
      const detailed = (check as any)?.details?.detailed_merge_status;
      const mergeStatus = (check as any)?.details?.merge_status;
      if (
        hasConflicts ||
        detailed === "conflicts" ||
        mergeStatus === "cannot_be_merged"
      ) {
        log?.(
          `冲突列表为空但 MR 标记为冲突（merge_status=${mergeStatus}, detailed=${detailed}, has_conflicts=${String(
            hasConflicts
          )}）。可能是二进制/大文件冲突、权限导致无法读取冲突详情，或 GitLab 端未生成 files 明细。`,
          true
        );
      }
    }

    let finalCheck = check;

    if (opts?.conflictHandler) {
      log?.(
        `检测到冲突: ${c.source} -> ${c.target} (MR !${iid})，等待用户解决...`
      );
      try {
        const resolution = await opts.conflictHandler({
          projectId,
          mrIid: iid,
          mrWebUrl: c.mr.web_url,
          source: c.source,
          target: c.target,
          conflicts: conflictList,
          conflictApiDebug,
          mrDetails: (check as any)?.details,
        });
        if (resolution.resolved) {
          const commitPushed = (resolution as any)?.commitPushed;
          if (commitPushed) {
            log?.(`用户已提交冲突解决到源分支，等待 GitLab 更新 MR 状态...`);
            log?.(`提示：由于使用 Commits API 提交，GitLab 需要更多时间重新计算 MR 状态（最多等待 3 分钟）...`);
          } else {
            log?.(`用户标记冲突已解决，重新检测可合并状态...`);
            log?.(`提示：GitLab 需要时间处理提交并更新 MR 状态，最多等待 2 分钟...`);
          }
          const recheck = await waitUntilMergeable(client, projectId, iid, {
            onProgress: (m) => log?.(m),
            strictConflictCheck: false,
            maxRetries: commitPushed ? 90 : 60, // 如果是 commit 提交，等待 3 分钟；否则 2 分钟
            pollIntervalMs: 2000,
          });
          if (recheck.ok) {
            log?.(`冲突已解决且 MR 可合并: ${c.source} -> ${c.target}`);
            continue;
          } else if (recheck.reason?.includes('MR 已处于 merged')) {
            // MR 已经被合并，说明冲突解决成功
            log?.(`✓ MR 已被合并: ${c.source} -> ${c.target} (MR !${iid})`);
            continue;
          } else if (recheck.reason?.includes('MR 已处于 closed')) {
            // MR 被关闭，可能是用户在 GitLab 上手动关闭的
            log?.(`警告：MR 已被关闭: ${c.source} -> ${c.target} (MR !${iid})`, true);
            log?.(`如果您在 GitLab 网页上手动合并了此 MR，请忽略此警告。`, false);
            // 不触发回滚，直接跳过
            continue;
          } else {
            log?.(`重新检测失败: ${recheck.reason}`, true);
            if (commitPushed) {
              log?.(`提示：您已成功提交冲突解决到源分支 ${c.source}，但 GitLab 可能需要更多时间更新 MR 状态。`, true);
              log?.(`建议操作：`, true);
              log?.(`  1. 在 GitLab 网页上打开 MR !${iid}，检查是否仍有冲突`, true);
              log?.(`  2. 如果 MR 显示"可以合并"，请手动点击合并按钮`, true);
              log?.(`  3. 如果 MR 仍显示有冲突，请检查提交的文件是否正确`, true);
            } else {
              log?.(`提示：如果您确认已解决所有冲突，可能是 GitLab 服务器响应较慢。建议：1) 在 GitLab 网页上手动检查 MR 状态；2) 如果 MR 显示可合并，可手动点击合并按钮。`, true);
            }
            finalCheck = recheck;
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
      reason: finalCheck.reason,
      mrIid: iid,
      mrWebUrl: (finalCheck.details as any)?.web_url,
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
