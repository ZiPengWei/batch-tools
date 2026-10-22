import type { CnbClient } from "../cnbClient";
import type { CnbPull } from "../../../shared/cnb/types";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type LogFn = (msg: string, error?: boolean) => void;

export type MergeableCheck =
  | { ok: true; details: CnbPull }
  | {
      ok: false;
      kind: "conflict" | "noop" | "merged" | "closed" | "timeout";
      details?: CnbPull;
      reason: string;
    };

/**
 * 轮询等待 PR 进入可判定状态（基于 CNB 的 mergeable_state / blocked_on）：
 * - mergeable → 可合并
 * - conflict / blocked_on=code_conflict → 代码冲突
 * - state=merged → 已被合并（如手动在网页合并）
 * - state=closed → 已被关闭
 * - checking / merging → 继续等待
 * - 超时 → timeout
 */
export async function waitUntilMergeable(
  client: CnbClient,
  repo: string,
  pullNumber: string | number,
  opts?: {
    maxRetries?: number;
    pollIntervalMs?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<MergeableCheck> {
  const maxRetries = opts?.maxRetries ?? 30;
  const pollIntervalMs = opts?.pollIntervalMs ?? 1500;

  let lastDetails: CnbPull | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(pollIntervalMs);
    const details = await client.getPull(repo, pullNumber);
    lastDetails = details;

    const state = String(details.state || "");
    const mergeableState = String(details.mergeable_state || "");
    const blockedOn = String(details.blocked_on || "");

    opts?.onProgress?.(
      `  [PR #${pullNumber}] 检测 ${attempt + 1}/${maxRetries}: state=${state}, mergeable_state=${mergeableState}${
        blockedOn ? `, blocked_on=${blockedOn}` : ""
      }`
    );

    if (state === "merged")
      return { ok: false, kind: "merged", details, reason: "PR 已处于 merged 状态" };
    if (state === "closed")
      return { ok: false, kind: "closed", details, reason: "PR 已被关闭" };

    if (mergeableState === "conflict" || blockedOn === "code_conflict") {
      return {
        ok: false,
        kind: "conflict",
        details,
        reason: "检测到代码冲突（不可合并）",
      };
    }
    if (mergeableState === "no-merge-base" || blockedOn === "no_merge_base") {
      return {
        ok: false,
        kind: "conflict",
        details,
        reason: "两个分支没有共同祖先（no merge base）",
      };
    }

    if (mergeableState === "mergeable") return { ok: true, details };
    // checking / merging / 其他 → 继续轮询
  }
  return {
    ok: false,
    kind: "timeout",
    details: lastDetails,
    reason: "超时：无法确认是否可合并（服务器可能需要更多时间）",
  };
}

/**
 * 合并后轮询确认 PR 进入 merged 状态
 */
export async function waitUntilMerged(
  client: CnbClient,
  repo: string,
  pullNumber: string | number,
  opts?: {
    maxRetries?: number;
    pollIntervalMs?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<
  | { ok: true; details: CnbPull }
  | { ok: false; details?: CnbPull; reason: string }
> {
  const maxRetries = opts?.maxRetries ?? 15;
  const pollIntervalMs = opts?.pollIntervalMs ?? 2000;

  let lastDetails: CnbPull | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await sleep(pollIntervalMs);
    const details = await client.getPull(repo, pullNumber);
    lastDetails = details;
    const state = String(details.state || "");
    if (state === "merged") return { ok: true, details };
    if (state === "closed")
      return { ok: false, details, reason: "PR 已被关闭（未合并）" };
    opts?.onProgress?.(
      `  [PR #${pullNumber}] 等待合并 ${attempt + 1}/${maxRetries}: state=${state}`
    );
  }
  return {
    ok: false,
    details: lastDetails,
    reason: "超时：合并未完成",
  };
}
