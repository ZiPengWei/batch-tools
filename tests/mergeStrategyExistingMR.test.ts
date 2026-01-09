import { describe, expect, it, vi } from "vitest";
import { MergeService } from "../src/main/services/mergeService";

function createClientMock() {
  return {
    createMergeRequest: vi.fn(),
    findOpenMergeRequest: vi.fn(),
    deleteMergeRequest: vi.fn().mockResolvedValue(true),
    getMergeRequestConflicts: vi
      .fn()
      .mockResolvedValue([{ type: "text", new_path: "conflict.txt" }]),
    getMergeRequestConflictsJsonByMrWebUrl: vi.fn().mockResolvedValue([]),
    getMergeRequestChanges: vi
      .fn()
      .mockResolvedValue({ changes: [{ path: "x" }] }),
    getMergeRequest: vi.fn(),
    acceptMergeRequest: vi.fn().mockResolvedValue({}),
    updateMergeRequest: vi.fn().mockResolvedValue({}),
  } as const;
}

describe("MergeStrategy - Existing MR", () => {
  it("冲突列表为空但 MR 标记冲突时仍应进入冲突处理", async () => {
    vi.useFakeTimers();
    const client = createClientMock() as any;

    client.createMergeRequest.mockResolvedValueOnce({
      iid: 2001,
      web_url: "http://gitlab/mr/2001",
    });

    client.getMergeRequestConflicts.mockImplementationOnce(
      async (_projectId: number, _mrIid: number, diagnostic?: any) => {
        diagnostic?.({
          ok: true,
          method: "GET",
          url: "http://gitlab/api/v4/projects/1/merge_requests/2001/conflicts",
          status: 409,
          filesCount: 0,
          bodyType: "object",
          bodyKeys: ["files"],
        });
        return [];
      }
    );

    client.getMergeRequestChanges.mockResolvedValueOnce({
      changes: [{ new_path: "a.txt" }],
    });

    client.getMergeRequest.mockResolvedValueOnce({
      iid: 2001,
      web_url: "http://gitlab/mr/2001",
      merge_status: "cannot_be_merged",
      detailed_merge_status: "conflicts",
      has_conflicts: true,
      state: "opened",
      changes_count: "1",
    });

    const service = new MergeService(client);
    const conflictHandler = vi.fn().mockResolvedValue({ resolved: false });

    const p = service.runAtomicBatchMerge(
      1,
      [{ source: "feat", target: "main" }],
      { conflictHandler }
    );

    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(res.ok).toBe(false);
    expect(conflictHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        mrIid: 2001,
        conflicts: [],
        conflictApiDebug: expect.objectContaining({
          ok: true,
          status: 409,
          filesCount: 0,
        }),
        mrDetails: expect.objectContaining({
          has_conflicts: true,
          detailed_merge_status: "conflicts",
          merge_status: "cannot_be_merged",
        }),
      })
    );
  });

  it("冲突列表为空时应回退使用 conflicts.json 获取文件列表", async () => {
    vi.useFakeTimers();
    const client = createClientMock() as any;

    client.createMergeRequest.mockResolvedValueOnce({
      iid: 2001,
      web_url: "http://gitlab/group/proj/-/merge_requests/2001",
    });

    client.getMergeRequestConflicts.mockImplementationOnce(
      async (_projectId: number, _mrIid: number, diagnostic?: any) => {
        diagnostic?.({
          ok: true,
          method: "GET",
          url: "http://gitlab/api/v4/projects/1/merge_requests/2001/conflicts",
          status: 409,
          filesCount: 0,
          bodyType: "object",
          bodyKeys: ["files"],
        });
        return [];
      }
    );

    client.getMergeRequestConflictsJsonByMrWebUrl.mockImplementationOnce(
      async (_mrWebUrl: string, _mrIid: number, diagnostic?: any) => {
        diagnostic?.({
          ok: true,
          method: "GET",
          url: "http://gitlab/group/proj/-/merge_requests/2001/conflicts.json",
          status: 200,
          filesCount: 1,
          bodyType: "object",
          bodyKeys: ["files"],
        });
        return [{ type: "text", new_path: "from_json.txt" }];
      }
    );

    client.getMergeRequestChanges.mockResolvedValueOnce({
      changes: [{ new_path: "from_json.txt" }],
    });

    client.getMergeRequest.mockResolvedValueOnce({
      iid: 2001,
      web_url: "http://gitlab/group/proj/-/merge_requests/2001",
      merge_status: "cannot_be_merged",
      detailed_merge_status: "conflicts",
      has_conflicts: true,
      state: "opened",
      changes_count: "1",
    });

    const service = new MergeService(client);
    const conflictHandler = vi.fn().mockResolvedValue({ resolved: false });

    const p = service.runAtomicBatchMerge(
      1,
      [{ source: "feat", target: "main" }],
      { conflictHandler }
    );

    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(res.ok).toBe(false);
    expect(client.getMergeRequestConflictsJsonByMrWebUrl).toHaveBeenCalledWith(
      "http://gitlab/group/proj/-/merge_requests/2001",
      2001,
      expect.any(Function)
    );
    expect(conflictHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        mrIid: 2001,
        conflicts: [{ type: "text", new_path: "from_json.txt" }],
        conflictApiDebug: expect.objectContaining({
          ok: true,
          status: 409,
          conflictsJson: expect.objectContaining({ status: 200 }),
        }),
      })
    );
  });

  it("createMergeRequest 失败时复用已存在的 MR 并继续流程", async () => {
    vi.useFakeTimers();
    const client = createClientMock();

    // 1. 模拟创建 MR 失败
    client.createMergeRequest.mockResolvedValueOnce({
      status: "error",
      message:
        "Another open merge request already exists for this source branch: !1222",
    });

    // 2. 模拟查找 open MR 成功
    client.findOpenMergeRequest.mockResolvedValueOnce({
      iid: 1222,
      web_url: "http://gitlab/mr/1222",
    });

    // 3. 预设所有 getMergeRequest 的 mock 返回值
    client.getMergeRequest
      .mockResolvedValueOnce({
        iid: 1222,
        web_url: "http://gitlab/mr/1222",
        merge_status: "cannot_be_merged",
        has_conflicts: true,
        state: "opened",
        changes_count: "1",
      })
      .mockResolvedValueOnce({
        iid: 1222,
        merge_status: "can_be_merged",
        has_conflicts: false,
        state: "opened",
        changes_count: "1",
      })
      .mockResolvedValueOnce({
        iid: 1222,
        state: "merged",
      });

    const service = new MergeService(client as any);
    const conflictHandler = vi.fn().mockResolvedValue({ resolved: true });

    const p = service.runAtomicBatchMerge(
      1,
      [{ source: "feat", target: "main" }],
      { conflictHandler }
    );

    // 等待所有流程完成
    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(client.findOpenMergeRequest).toHaveBeenCalledWith(1, "feat", "main");
    expect(conflictHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        mrWebUrl: "http://gitlab/mr/1222",
      })
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mergedIids).toContain(1222);
    }
  });

  it("回滚时不应删除已存在的 MR", async () => {
    vi.useFakeTimers();
    const client = createClientMock();

    // 1. 模拟创建 MR 失败
    client.createMergeRequest.mockResolvedValueOnce({
      status: "error",
      message: "Already exists",
    });
    // 2. 模拟查找 open MR 成功
    client.findOpenMergeRequest.mockResolvedValueOnce({ iid: 1222 });

    // 3. 模拟后续的可合并检查 -> 有冲突
    client.getMergeRequest.mockResolvedValueOnce({
      iid: 1222,
      merge_status: "cannot_be_merged",
      has_conflicts: true,
      state: "opened",
    });

    const service = new MergeService(client as any);
    // 用户取消解决冲突
    const conflictHandler = vi.fn().mockResolvedValue({ resolved: false });

    const p = service.runAtomicBatchMerge(
      1,
      [{ source: "feat", target: "main" }],
      { conflictHandler }
    );

    await vi.runAllTimersAsync();
    const res = await p;
    vi.useRealTimers();

    expect(client.findOpenMergeRequest).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect((res as any).rolledBack).toBe(true);

    // 关键断言：deleteMergeRequest 不应该被调用 (因为这是现有的 MR)
    expect(client.deleteMergeRequest).not.toHaveBeenCalled();
  });
});
