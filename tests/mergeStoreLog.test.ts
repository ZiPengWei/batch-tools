import { describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

let batchMergeLogCallback: ((e: any) => void) | null = null;
const stopListenSpy = vi.fn();

vi.mock("../src/renderer/ipc/bridge", () => {
  return {
    onBatchMergeLog: (cb: (e: any) => void) => {
      batchMergeLogCallback = cb;
      return () => {
        stopListenSpy();
        batchMergeLogCallback = null;
      };
    },
    batchMerge: async (payload: any) => {
      const runId = payload?.runId;
      batchMergeLogCallback?.({ runId: "other", text: "should-not-show" });
      batchMergeLogCallback?.({ runId, text: "step-1" });
      batchMergeLogCallback?.({ runId, text: "step-2", error: true });
      return { ok: true, mergedIids: [], noop: [] };
    },
  };
});

import { useMergeStore } from "../src/renderer/store/merge";

describe("merge store log wiring", () => {
  it("run() 会把批量合并日志写入 logLines，并按 runId 过滤", async () => {
    setActivePinia(createPinia());
    const store = useMergeStore();
    store.selectedTargets = ["main"];

    const res = await store.run(1, ["feat"]);
    expect(res?.ok).toBe(true);

    const texts = store.logLines.map((l) => l.text);
    expect(texts).toContain("=== 开始批量合并 ===");
    expect(texts).toContain("step-1");
    expect(texts).toContain("step-2");
    expect(texts).not.toContain("should-not-show");

    const step2 = store.logLines.find((l) => l.text === "step-2");
    expect(step2?.error).toBe(true);

    expect(stopListenSpy).toHaveBeenCalledTimes(1);
  });

  it("log() 会对重复日志合并计数，并在高频下限制详情条数", () => {
    setActivePinia(createPinia());
    const store = useMergeStore();

    for (let i = 0; i < 6000; i++) store.log("SAME");

    expect(store.logGroups.length).toBe(1);
    const g = store.logGroups[0];
    expect(g.count).toBe(6000);
    expect(g.items.length).toBeLessThanOrEqual(g.count);
    expect(g.dropped).toBe(g.count - g.items.length);
  });

  it("log() 会把 MR Ready: IID N 智能合并为同一组", () => {
    setActivePinia(createPinia());
    const store = useMergeStore();

    store.log("MR Ready: IID 1");
    store.log("MR Ready: IID 999");

    expect(store.logGroups.length).toBe(1);
    expect(store.logGroups[0].displayText).toBe("MR Ready: IID");
    expect(store.logGroups[0].count).toBe(2);
  });

  it("setTargets() 不应清空既有日志（避免结果弹窗日志丢失）", () => {
    setActivePinia(createPinia());
    const store = useMergeStore();

    store.log("测试日志-1");
    store.setTargets(["main"]);

    expect(store.logGroups.length).toBe(1);
    expect(store.logLines.length).toBe(1);
    expect(store.logGroups[0].displayText).toContain("测试日志-1");
  });
});
