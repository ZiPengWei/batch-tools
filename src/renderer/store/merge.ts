import { defineStore } from "pinia";
import { batchMerge, onBatchMergeLog } from "../ipc/bridge";

const isE2E =
  (import.meta as any).env?.VITE_E2E === "1" ||
  String((import.meta as any).env?.MODE || "").toLowerCase() === "e2e";

/**
 * 批量合并结果摘要（分支级明细）
 * - merged: 成功合并的分支对
 * - conflicts: 检测到冲突被跳过（PR 已取消）的分支对
 * - noop: 无变更跳过
 * - failures: 其他失败
 */
export type MergeRunSummary = {
  ok: boolean;
  merged: Array<{ source: string; target: string }>;
  conflicts: Array<{ source: string; target: string; reason?: string }>;
  noop: Array<{ source: string; target: string; reason?: string }>;
  failures: Array<{ source: string; target: string; reason?: string }>;
  message?: string;
};

export type MergeLogLine = {
  ts: number;
  text: string;
  error?: boolean;
};

function normalizeLogText(text: string) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_RAW_LOG_LINES = 20000;

export const useMergeStore = defineStore("merge", {
  state: () => ({
    targetFilter: "",
    targets: [] as string[],
    selectedTargets: [] as string[],
    logLines: [] as MergeLogLine[],
    running: false,
    activeRunId: "",
  }),
  actions: {
    setTargets(branches: string[]) {
      this.targets = branches.slice();
      this.selectedTargets = [];
    },
    toggleTarget(name: string) {
      if (this.selectedTargets.includes(name)) {
        this.selectedTargets = this.selectedTargets.filter((b) => b !== name);
      } else {
        this.selectedTargets = [...this.selectedTargets, name];
      }
    },
    log(text: string, error = false) {
      const ts = Date.now();
      const norm = normalizeLogText(text);
      this.logLines.push({ ts, text: norm, error });
      if (this.logLines.length > MAX_RAW_LOG_LINES) {
        this.logLines.splice(0, this.logLines.length - MAX_RAW_LOG_LINES);
      }
    },
    async run(
      repo: string,
      sourceBranches: string[]
    ): Promise<MergeRunSummary | null> {
      if (!repo || !sourceBranches.length || !this.selectedTargets.length)
        return null;
      const totalOps = sourceBranches.length * this.selectedTargets.length;
      this.running = true;
      this.logLines = [];
      const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      this.activeRunId = runId;
      this.log("=== 开始批量合并 ===");

      if (isE2E) {
        try {
          const steps = Math.min(200, Math.max(30, totalOps * 2));
          await new Promise<void>((resolve) => {
            let i = 0;
            const timer = window.setInterval(() => {
              i += 1;
              this.log(`E2E step ${i}/${steps}`);
              if (i >= steps) {
                window.clearInterval(timer);
                resolve();
              }
            }, 20);
          });
          this.log(`全部已合并，成功 PR 数量：${totalOps}`);
          return {
            ok: true,
            merged: this.selectedTargets.map((t) => ({
              source: sourceBranches[0] || "",
              target: t,
            })),
            conflicts: [],
            noop: [],
            failures: [],
          };
        } finally {
          this.running = false;
          this.activeRunId = "";
        }
      }

      const payload = {
        repo,
        pairs: sourceBranches.flatMap((s) =>
          this.selectedTargets.map((t) => ({
            source: s,
            target: t,
          }))
        ),
        runId,
      };

      let stopListen: (() => void) | null = null;
      try {
        stopListen = onBatchMergeLog((e) => {
          if (e?.runId && e.runId !== this.activeRunId) return;
          if (!e?.text) return;
          this.log(e.text, !!e.error);
        });
        const res = await batchMerge(payload);
        const summary: MergeRunSummary = {
          ok: res.ok,
          merged: res.merged || [],
          conflicts: res.conflicts || [],
          noop: res.noop || [],
          failures: res.failures || [],
        };
        if (summary.ok) {
          if (summary.merged.length === 0 && summary.noop.length > 0) {
            this.log(`本次无变更，已跳过：${summary.noop.length} 项`);
          } else {
            this.log(
              `全部已合并，成功分支：${summary.merged
                .map((m) => m.target)
                .join("、")}`
            );
          }
        } else {
          if (summary.merged.length)
            this.log(
              `成功合并的分支：${summary.merged
                .map((m) => `${m.source} -> ${m.target}`)
                .join("、")}`
            );
          if (summary.conflicts.length)
            this.log(
              `存在冲突已跳过的分支：${summary.conflicts
                .map((m) => `${m.source} -> ${m.target}`)
                .join("、")}`,
              true
            );
          if (summary.failures.length)
            this.log(
              `失败的分支：${summary.failures
                .map((m) => `${m.source} -> ${m.target}`)
                .join("、")}`,
              true
            );
          if (summary.noop.length)
            this.log(`已跳过无变更：${summary.noop.length} 项`);
        }
        return summary;
      } catch (e) {
        const msg = String(e);
        this.log(msg, true);
        return {
          ok: false,
          merged: [],
          conflicts: [],
          noop: [],
          failures: [],
          message: msg,
        };
      } finally {
        stopListen?.();
        this.running = false;
        this.activeRunId = "";
      }
    },
  },
});
