import { defineStore } from "pinia";
import { batchMerge } from "../ipc/bridge";

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

export const useMergeStore = defineStore("merge", {
  state: () => ({
    targetFilter: "",
    targets: [] as string[],
    selectedTargets: [] as string[],
    logLines: [] as { text: string; error?: boolean }[],
    progressMax: 0,
    progressValue: 0,
    running: false,
  }),
  actions: {
    setTargets(branches: string[]) {
      this.targets = branches.slice();
      this.selectedTargets = [];
      this.progressMax = 0;
      this.progressValue = 0;
      this.logLines = [];
    },
    toggleTarget(name: string) {
      if (this.selectedTargets.includes(name)) {
        this.selectedTargets = this.selectedTargets.filter((b) => b !== name);
      } else {
        this.selectedTargets = [...this.selectedTargets, name];
      }
    },
    log(text: string, error = false) {
      this.logLines.push({ text, error });
    },
    async run(
      projectId: number,
      sourceBranches: string[]
    ): Promise<MergeRunSummary | null> {
      if (!projectId || !sourceBranches.length || !this.selectedTargets.length)
        return null;
      const totalOps = sourceBranches.length * this.selectedTargets.length;
      this.progressMax = totalOps;
      this.progressValue = 0;
      this.running = true;
      this.logLines = [];
      this.log("=== 开始批量合并 ===");

      const payload = {
        projectId,
        pairs: sourceBranches.flatMap((s) =>
          this.selectedTargets.map((t) => ({
            source: s,
            target: t,
          }))
        ),
      };

      try {
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
        this.running = false;
      }
    },
  },
});
