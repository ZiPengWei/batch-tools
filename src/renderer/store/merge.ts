import { defineStore } from "pinia";
import { batchMerge, onBatchMergeLog } from "../ipc/bridge";

const isE2E =
  (import.meta as any).env?.VITE_E2E === "1" ||
  String((import.meta as any).env?.MODE || "").toLowerCase() === "e2e";

export type MergeRunSummary =
  | {
      ok: true;
      mergedCount: number;
      noopCount: number;
    }
  | {
      ok: false;
      conflictsCount: number;
      rolledBack: boolean;
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
      projectId: number,
      sourceBranches: string[]
    ): Promise<MergeRunSummary | null> {
      if (!projectId || !sourceBranches.length || !this.selectedTargets.length)
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
          this.log(`全部已合并，成功 MR 数量：${totalOps}`);
          return { ok: true, mergedCount: totalOps, noopCount: 0 };
        } finally {
          this.running = false;
          this.activeRunId = "";
        }
      }

      const payload = {
        projectId,
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
        if (res.ok) {
          const mergedCount = res.mergedIids.length;
          const noopCount = res.noop?.length || 0;
          if (mergedCount === 0 && noopCount > 0) {
            this.log(`本次无变更，已跳过：${noopCount} 项`);
          } else {
            this.log(`全部已合并，成功 MR 数量：${mergedCount}`);
            if (noopCount) this.log(`已跳过无变更：${noopCount} 项`);
          }
          return { ok: true, mergedCount, noopCount };
        } else {
          if (res.rolledBack) this.log("已回滚本次创建的 MR。", true);
          this.log(`存在冲突或失败：${res.conflicts.length} 项`, true);
          return {
            ok: false,
            conflictsCount: res.conflicts.length,
            rolledBack: !!res.rolledBack,
          };
        }
      } catch (e) {
        const msg = String(e);
        this.log(msg, true);
        return {
          ok: false,
          conflictsCount: 0,
          rolledBack: false,
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
