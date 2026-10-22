import { extractErrorMessage } from "../cnbClient";
import type { CnbClient } from "../cnbClient";
import type {
  MergeConflict,
  MergeFailure,
  MergeMerged,
  MergeNoop,
  MergePair,
  MergeResult,
} from "../mergeTypes";
import { waitUntilMergeable, waitUntilMerged, type LogFn } from "./shared";

/**
 * 批量合并策略（每个目标分支独立处理）：
 *
 * 1. 逐个处理 (source, target) 分支对，互不影响：
 *    - 无变更 → 跳过（noop）
 *    - 检测到冲突 → 跳过该分支并取消（关闭）对应 PR
 *    - 无冲突 → 直接合并
 * 2. 复用已存在的同源同目标 open PR
 * 3. 全部处理完后汇总：哪些分支冲突、哪些分支成功合并
 */
export async function runBatchMerge(
  client: CnbClient,
  repo: string,
  pairs: MergePair[],
  opts?: { onLog?: LogFn }
): Promise<MergeResult> {
  const merged: MergeMerged[] = [];
  const conflicts: MergeConflict[] = [];
  const noop: MergeNoop[] = [];
  const failures: MergeFailure[] = [];

  const log = (m: string, e?: boolean) => opts?.onLog?.(m, e);

  for (const { source, target } of pairs) {
    if (source === target) {
      noop.push({ type: "noop", source, target, reason: "source == target" });
      continue;
    }

    log(`正在处理: ${source} -> ${target}`);

    // 无变更预检：比较 target...source，无新提交则跳过
    const cmp = await client.compareBranches(repo, target, source);
    if (cmp && cmp.totalCommits === 0) {
      noop.push({ type: "noop", source, target, reason: "无变更" });
      log(`无变更，跳过: ${source} -> ${target}`);
      continue;
    }

    // 创建 PR（或复用已存在的 open PR）
    log(`正在创建 PR: ${source} -> ${target} ...`);
    const created = await client.createPull(
      repo,
      source,
      target,
      `Merge ${source} into ${target} [Batch Tool]`
    );

    let pr: { number?: string | number; [key: string]: unknown } | null = null;

    if ((created as any).status === "noop") {
      noop.push({
        type: "noop",
        source,
        target,
        reason: (created as any).message || "无变更",
      });
      log(`无需合并（无变更）: ${source} -> ${target}`);
      continue;
    } else if ((created as any).status === "error") {
      const existing = await client.findOpenPull(repo, source, target);
      if (existing) {
        log(`检测到已存在的 PR #${existing.number}，将使用该 PR 继续处理`);
        pr = existing;
      } else {
        failures.push({
          type: "failure",
          source,
          target,
          reason: (created as any).message || "创建 PR 失败",
        });
        log(`创建 PR 失败: ${source} -> ${target} - ${(created as any).message}`, true);
        continue;
      }
    } else {
      pr = created;
    }

    const prNumber = String((pr as any)?.number ?? "");
    if (!prNumber) {
      failures.push({
        type: "failure",
        source,
        target,
        reason: "创建 PR 失败：未返回 PR 编号",
      });
      log(`创建 PR 失败: ${source} -> ${target} - 未返回 PR 编号`, true);
      continue;
    }
    log(`PR Ready: #${prNumber}`);

    // 等待可合并状态判定
    const check = await waitUntilMergeable(client, repo, prNumber, {
      onProgress: (m) => log(m),
    });

    if (check.ok) {
      // 无冲突 → 直接合并
      log(`无冲突，执行合并: ${source} -> ${target} (PR #${prNumber})`);
      try {
        const res = await client.mergePull(repo, prNumber, {
          // CNB 合并接口要求 commit_title 必填，缺失返回 400
          commitTitle: `Merge ${source} into ${target} [Batch Tool]`,
        });
        if (res.merged) {
          merged.push({ type: "merged", source, target, prNumber });
          log(`✓ 合并成功: ${source} -> ${target} (PR #${prNumber})`);
          continue;
        }
        // 接口未直接确认，轮询核实最终状态
        const wait = await waitUntilMerged(client, repo, prNumber, {
          onProgress: (m) => log(m),
        });
        if (wait.ok) {
          merged.push({ type: "merged", source, target, prNumber });
          log(`✓ 合并成功: ${source} -> ${target} (PR #${prNumber})`);
        } else {
          await client.closePull(repo, prNumber).catch(() => {});
          failures.push({
            type: "failure",
            source,
            target,
            reason: wait.reason,
            prNumber,
          });
          log(`合并未完成: ${source} -> ${target} (PR #${prNumber}) - ${wait.reason}`, true);
        }
      } catch (e) {
        // 提取 CNB 返回的具体错误（如 errmsg），避免只显示笼统的 "status code 400"
        const reason = extractErrorMessage(e).message || String(e);
        await client.closePull(repo, prNumber).catch(() => {});
        failures.push({ type: "failure", source, target, reason, prNumber });
        log(`合并调用失败: ${source} -> ${target} (PR #${prNumber}) - ${reason}`, true);
      }
      continue;
    }

    // 不可合并的场景
    if (check.kind === "merged") {
      // PR 已处于 merged 状态（可能在网页上被手动合并）
      merged.push({ type: "merged", source, target, prNumber });
      log(`✓ PR 已被合并: ${source} -> ${target} (PR #${prNumber})`);
      continue;
    }

    if (check.kind === "conflict") {
      // 冲突 → 跳过该分支并取消 PR
      const closed = await client.closePull(repo, prNumber).catch(() => false);
      conflicts.push({
        type: "conflict",
        source,
        target,
        reason: check.reason,
        prNumber,
      });
      log(
        `✗ 检测到冲突，已跳过并${closed ? "取消 PR" : "尝试取消 PR（失败）"}: ${source} -> ${target} (PR #${prNumber})`,
        true
      );
      continue;
    }

    // closed / timeout 等 → 视为失败，取消 PR
    if (check.kind !== "closed") {
      await client.closePull(repo, prNumber).catch(() => {});
    }
    failures.push({
      type: "failure",
      source,
      target,
      reason: check.reason,
      prNumber,
    });
    log(`处理失败: ${source} -> ${target} (PR #${prNumber}) - ${check.reason}`, true);
  }

  // 汇总
  log("=== 批量合并结束 ===");
  if (merged.length)
    log(`成功合并的分支: ${merged.map((m) => `${m.source} -> ${m.target}`).join("、")}`);
  if (conflicts.length)
    log(
      `存在冲突已跳过的分支: ${conflicts
        .map((m) => `${m.source} -> ${m.target}`)
        .join("、")}`,
      true
    );
  if (failures.length)
    log(
      `失败的分支: ${failures.map((m) => `${m.source} -> ${m.target}`).join("、")}`,
      true
    );
  if (noop.length) log(`无变更跳过: ${noop.length} 项`);

  return {
    ok: conflicts.length === 0 && failures.length === 0,
    merged,
    conflicts,
    noop,
    failures,
  };
}
