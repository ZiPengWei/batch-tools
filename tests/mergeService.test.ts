import { describe, expect, it, vi } from "vitest";

import { MergeService } from "../src/main/services/mergeService";

function createClientMock() {
  return {
    createMergeRequest: vi.fn(),
    deleteMergeRequest: vi.fn().mockResolvedValue(true),
    getMergeRequestConflicts: vi.fn().mockResolvedValue([]),
    getMergeRequestChanges: vi
      .fn()
      .mockResolvedValue({ changes: [{ path: "x" }] }),
    getMergeRequest: vi.fn(),
    acceptMergeRequest: vi.fn().mockResolvedValue({}),
    updateMergeRequest: vi.fn().mockResolvedValue({}),
  } as const;
}

describe("MergeService.runAtomicBatchMerge", () => {
  it("opts.onLog 会收到进度日志", async () => {
    vi.useFakeTimers();
    const client = createClientMock();
    client.createMergeRequest.mockResolvedValueOnce({ iid: 1 });
    const service = new MergeService(client as any);
    client.getMergeRequest
      .mockResolvedValueOnce({
        iid: 1,
        merge_status: "can_be_merged",
        detailed_merge_status: null,
        has_conflicts: false,
        state: "opened",
        changes_count: "1",
      })
      .mockResolvedValueOnce({
        iid: 1,
        state: "merged",
      });

    const onLog = vi.fn();
    const p = service.runAtomicBatchMerge(
      1,
      [{ source: "feat", target: "main" }],
      { onLog }
    );
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();

    expect(onLog).toHaveBeenCalled();
    const texts = onLog.mock.calls.map((c) => c[0]);
    expect(texts.some((t) => String(t).includes("正在创建 MR"))).toBe(true);
    expect(texts.some((t) => String(t).includes("=== 阶段 2"))).toBe(true);
    expect(texts.some((t) => String(t).includes("=== 阶段 3"))).toBe(true);
  });

  it("source==target 时返回 noop 且不创建 MR", async () => {
    const client = createClientMock();
    const service = new MergeService(client as any);

    const res = await service.runAtomicBatchMerge(1, [
      { source: "a", target: "a" },
    ]);

    expect(client.createMergeRequest).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.mergedIids).toEqual([]);
    expect(res.noop).toEqual([
      { type: "noop", source: "a", target: "a", reason: "source == target" },
    ]);
  });

  it("检测到无变更时删除 MR 并跳过后续合并", async () => {
    vi.useFakeTimers();
    const client = createClientMock();
    client.createMergeRequest.mockResolvedValueOnce({ iid: 10 });

    const service = new MergeService(client as any);
    client.getMergeRequest.mockResolvedValueOnce({
      iid: 10,
      merge_status: "can_be_merged",
      detailed_merge_status: "nothing_to_merge",
      has_conflicts: false,
      state: "opened",
      changes_count: "0",
    });
    client.getMergeRequestChanges.mockResolvedValueOnce({ changes: [] });

    const p = service.runAtomicBatchMerge(1, [
      { source: "feat", target: "main" },
    ]);
    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(client.deleteMergeRequest).toHaveBeenCalledWith(1, 10);
    expect(client.acceptMergeRequest).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.mergedIids).toEqual([]);
    expect(res.noop).toEqual([
      {
        type: "noop",
        source: "feat",
        target: "main",
        reason: "无变更",
        mrIid: 10,
      },
    ]);
  });

  it("阶段 2 出现冲突时触发回滚并删除已创建 MR", async () => {
    vi.useFakeTimers();
    const client = createClientMock();
    client.createMergeRequest
      .mockResolvedValueOnce({ iid: 1 })
      .mockResolvedValueOnce({ iid: 2 });
    client.getMergeRequestConflicts.mockResolvedValueOnce([{ file: "a.txt" }]);

    const service = new MergeService(client as any);
    client.getMergeRequest
      .mockResolvedValueOnce({
        iid: 1,
        merge_status: "can_be_merged",
        detailed_merge_status: null,
        has_conflicts: false,
        state: "opened",
        changes_count: "1",
      })
      .mockResolvedValueOnce({
        iid: 2,
        merge_status: "cannot_be_merged",
        detailed_merge_status: "conflicts",
        has_conflicts: true,
        state: "opened",
        changes_count: "1",
        web_url: "u",
      });
    client.getMergeRequestChanges.mockResolvedValueOnce({
      changes: [{ path: "x" }],
    });

    const p = service.runAtomicBatchMerge(1, [
      { source: "a", target: "main" },
      { source: "b", target: "main" },
    ]);
    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.rolledBack).toBe(true);
    expect(res.conflicts).toEqual([
      {
        type: "conflict",
        source: "b",
        target: "main",
        reason: "检测到冲突（不可合并）",
        mrIid: 2,
        mrWebUrl: "u",
        conflicts: [{ file: "a.txt" }],
      },
    ]);
    expect(client.deleteMergeRequest).toHaveBeenCalledWith(1, 1);
    expect(client.deleteMergeRequest).toHaveBeenCalledWith(1, 2);
  });

  it("阶段 3 合并未完成时不回滚但会关闭 MR 并返回失败", async () => {
    vi.useFakeTimers();
    const client = createClientMock();
    client.createMergeRequest.mockResolvedValueOnce({ iid: 3 });

    const service = new MergeService(client as any);
    client.getMergeRequest
      .mockResolvedValueOnce({
        iid: 3,
        merge_status: "can_be_merged",
        detailed_merge_status: null,
        has_conflicts: false,
        state: "opened",
        changes_count: "1",
      })
      .mockResolvedValueOnce({
        iid: 3,
        state: "closed",
      });

    const p = service.runAtomicBatchMerge(1, [
      { source: "feat", target: "main" },
    ]);
    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.rolledBack).toBe(false);
    expect(client.updateMergeRequest).toHaveBeenCalledWith(1, 3, "close");
    expect(res.conflicts[0]).toMatchObject({ mrIid: 3 });
  });
});

vi.mock("axios", async () => {
  const actual = await vi.importActual<any>("axios");
  return {
    ...actual,
    default: {
      create: vi.fn(),
      isAxiosError: (e: any) => Boolean(e && e.isAxiosError),
    },
    create: vi.fn(),
    isAxiosError: (e: any) => Boolean(e && e.isAxiosError),
  };
});

describe("GitLabClient.conflicts.json", () => {
  it("conflicts.json 200 且包含 files 时能解析为冲突文件列表", async () => {
    const axiosMod: any = await import("axios");
    const get = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: { files: [{ new_path: "a.txt" }, { new_path: "b.txt" }] },
      headers: { "content-type": "application/json" },
      config: { headers: { "PRIVATE-TOKEN": "t" } },
    });
    (axiosMod.default.create as any).mockReturnValueOnce({ get });

    const { GitLabClient } = await import("../src/main/services/gitlabClient");
    const client = new GitLabClient("http://gitlab.example", "t");
    const diag = vi.fn();
    const res = await client.getMergeRequestConflictsJsonByMrWebUrl(
      "http://gitlab.example/group/proj/-/merge_requests/1291",
      1291,
      diag
    );
    expect(res.map((x: any) => x.new_path)).toEqual(["a.txt", "b.txt"]);
    expect(diag).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, status: 200 })
    );
  });

  it("conflicts.json 404 时返回空列表并记录诊断", async () => {
    const axiosMod: any = await import("axios");
    const get = vi.fn().mockResolvedValueOnce({
      status: 404,
      data: { message: "Not Found" },
      headers: { "content-type": "application/json" },
      config: { headers: { "PRIVATE-TOKEN": "t" } },
    });
    (axiosMod.default.create as any).mockReturnValueOnce({ get });

    const { GitLabClient } = await import("../src/main/services/gitlabClient");
    const client = new GitLabClient("http://gitlab.example", "t");
    const diag = vi.fn();
    const res = await client.getMergeRequestConflictsJsonByMrWebUrl(
      "http://gitlab.example/group/proj/-/merge_requests/1291",
      1291,
      diag
    );
    expect(res).toEqual([]);
    expect(diag).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, status: 404 })
    );
  });

  it("conflicts.json 200 但返回 HTML 时应当返回空列表并标记诊断失败", async () => {
    const axiosMod: any = await import("axios");
    const get = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: "<html>login</html>",
      headers: { "content-type": "text/html; charset=utf-8" },
      config: { headers: { "PRIVATE-TOKEN": "t" } },
    });
    (axiosMod.default.create as any).mockReturnValueOnce({ get });

    const { GitLabClient } = await import("../src/main/services/gitlabClient");
    const client = new GitLabClient("http://gitlab.example", "t");
    const diag = vi.fn();
    const res = await client.getMergeRequestConflictsJsonByMrWebUrl(
      "http://gitlab.example/group/proj/-/merge_requests/1291",
      1291,
      diag
    );
    expect(res).toEqual([]);
    expect(diag).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, status: 200 })
    );
  });
});
