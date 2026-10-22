import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const bridgeState = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  pinResult: { ok: true } as { ok: true } | { ok: false; error: { status: number; message: string } },
}));

vi.mock("../src/renderer/ipc/bridge", () => ({
  listProjects: vi.fn(async () => ({ items: bridgeState.items })),
  listBranches: vi.fn(async () => ({ branches: [] })),
  // 写回成功时联动更新 mock 的服务端数据（模拟置顶操作真实生效）
  setRepoPinned: vi.fn(async (payload: { repo: string; pinned: boolean }) => {
    if (bridgeState.pinResult.ok) {
      const item = bridgeState.items.find((i) => i.id === payload.repo);
      if (item) item.pinned = payload.pinned;
    }
    return bridgeState.pinResult;
  }),
}));

import { useProjectsStore } from "../src/renderer/store/projects";

function mkItem(id: string, pinned = false) {
  return {
    id,
    display: id,
    search: id,
    pinyinFull: "",
    pinyinInitials: "",
    pinned,
  };
}

describe("projects store 仓库置顶", () => {
  beforeEach(() => {
    localStorage.clear();
    bridgeState.items = [mkItem("a/x"), mkItem("b/y")];
    bridgeState.pinResult = { ok: true };
    setActivePinia(createPinia());
  });

  it("togglePin 切换置顶并持久化到 localStorage", async () => {
    const store = useProjectsStore();
    store.items = [mkItem("a/x"), mkItem("b/y")];

    expect(store.pinnedRepos).toEqual([]);

    await store.togglePin("b/y");
    expect(store.pinnedRepos).toEqual(["b/y"]);
    expect(JSON.parse(localStorage.getItem("cnb-pinned-repos") || "[]")).toEqual([
      "b/y",
    ]);

    await store.togglePin("b/y");
    expect(store.pinnedRepos).toEqual([]);
    expect(JSON.parse(localStorage.getItem("cnb-pinned-repos") || "[]")).toEqual(
      []
    );
  });

  it("sortedItems 将置顶仓库排在最前，各组内保持原顺序", async () => {
    const store = useProjectsStore();
    store.items = [mkItem("a/1"), mkItem("b/2"), mkItem("c/3")];

    await store.togglePin("c/3");
    await store.togglePin("a/1");

    expect(store.sortedItems.map((p) => p.id)).toEqual(["a/1", "c/3", "b/2"]);

    await store.togglePin("a/1");
    expect(store.sortedItems.map((p) => p.id)).toEqual(["c/3", "a/1", "b/2"]);
  });

  it("刷新后从 localStorage 恢复置顶状态", () => {
    localStorage.setItem("cnb-pinned-repos", JSON.stringify(["x/y"]));
    setActivePinia(createPinia());
    const store = useProjectsStore();
    expect(store.pinnedRepos).toEqual(["x/y"]);
  });

  it("过滤与置顶叠加：过滤结果内仍置顶优先", async () => {
    const store = useProjectsStore();
    store.items = [mkItem("feat-a"), mkItem("feat-b"), mkItem("dev-c")];
    await store.togglePin("dev-c");
    store.setFilter("feat");

    expect(store.sortedItems.map((p) => p.id)).toEqual(["feat-a", "feat-b"]);
  });

  it("loadProjects 会清理已不存在仓库的置顶项并持久化", async () => {
    localStorage.setItem(
      "cnb-pinned-repos",
      JSON.stringify(["gone/repo", "a/x"])
    );
    setActivePinia(createPinia());
    const store = useProjectsStore();
    expect(store.pinnedRepos).toEqual(["gone/repo", "a/x"]);

    await store.loadProjects();

    expect(store.pinnedRepos).toEqual(["a/x"]);
    expect(JSON.parse(localStorage.getItem("cnb-pinned-repos") || "[]")).toEqual([
      "a/x",
    ]);
  });

  it("CNB 服务端置顶的仓库加载后自动置顶并排前", async () => {
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true), mkItem("c/z", true)];
    const store = useProjectsStore();

    await store.loadProjects();

    expect(store.pinnedRepos.sort()).toEqual(["b/y", "c/z"]);
    expect(store.sortedItems.map((p) => p.id)).toEqual(["b/y", "c/z", "a/x"]);
  });

  it("应用内取消服务端置顶后，刷新列表不会被重新置顶", async () => {
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true)];
    const store = useProjectsStore();

    await store.loadProjects();
    expect(store.pinnedRepos).toEqual(["b/y"]);

    // 应用内取消服务端置顶（写回成功 → 服务端同步取消）
    await store.togglePin("b/y");
    expect(store.pinnedRepos).toEqual([]);
    // 写回成功后本地来源记录已清除（服务端即权威）
    expect(
      JSON.parse(localStorage.getItem("cnb-unpinned-server-pins") || "[]")
    ).toEqual([]);

    // 再次刷新（服务端已取消置顶）不应恢复
    await store.loadProjects();
    expect(store.pinnedRepos).toEqual([]);
  });

  it("写回成功后用户在网页重新置顶，应用刷新跟随恢复", async () => {
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true)];
    const store = useProjectsStore();

    await store.loadProjects();
    await store.togglePin("b/y"); // 应用内取消（写回成功）
    expect(store.pinnedRepos).toEqual([]);

    // 用户在 CNB 网页上重新置顶
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true)];
    await store.loadProjects();

    expect(store.pinnedRepos).toEqual(["b/y"]);
  });

  it("应用内手动置顶写回成功后，网页端取消置顶时刷新跟随移除", async () => {
    const store = useProjectsStore();
    store.items = [mkItem("a/x"), mkItem("b/y")];

    await store.togglePin("b/y"); // 应用内手动置顶（写回成功）
    expect(store.pinnedRepos).toEqual(["b/y"]);
    // 本地来源记录已清除，服务端状态为权威
    expect(store.localPins).toEqual([]);

    // 用户在 CNB 网页上取消置顶
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", false)];
    await store.loadProjects();

    expect(store.pinnedRepos).toEqual([]);
  });

  it("应用内重新置顶服务端置顶仓库后，刷新仍保持置顶", async () => {
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true)];
    const store = useProjectsStore();

    await store.loadProjects();
    await store.togglePin("b/y"); // 取消
    await store.loadProjects();
    expect(store.pinnedRepos).toEqual([]);

    await store.togglePin("b/y"); // 重新置顶
    expect(store.pinnedRepos).toEqual(["b/y"]);

    await store.loadProjects();
    expect(store.pinnedRepos).toEqual(["b/y"]);
  });

  it("应用内手动置顶（非服务端置顶）在刷新后保留", async () => {
    const store = useProjectsStore();
    store.items = [mkItem("a/x"), mkItem("b/y")];

    await store.togglePin("a/x");
    await store.loadProjects();

    expect(store.pinnedRepos).toEqual(["a/x"]);
    expect(store.sortedItems.map((p) => p.id)).toEqual(["a/x", "b/y"]);
  });

  it("服务端取消置顶后，本地同步移除该置顶", async () => {
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true)];
    const store = useProjectsStore();

    await store.loadProjects();
    expect(store.pinnedRepos).toEqual(["b/y"]);

    // 用户在 CNB 网页上取消了 b/y 的置顶
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", false)];
    await store.loadProjects();

    expect(store.pinnedRepos).toEqual([]);
  });

  it("置顶写回 CNB 成功后更新内存中的服务端标记", async () => {
    const store = useProjectsStore();
    store.items = [mkItem("a/x"), mkItem("b/y")];

    await store.togglePin("b/y");

    expect(store.pinnedRepos).toEqual(["b/y"]);
    expect(store.pinError).toBe("");
    // items 里的 pinned 标记同步更新（服务端已生效）
    expect((store.items as any[]).find((i) => i.id === "b/y")?.pinned).toBe(true);
    // 本地来源记录清除，服务端状态成为唯一权威
    expect(store.localPins).toEqual([]);
    expect(store.localUnpinnedServerPins).toEqual([]);
  });

  it("置顶写回失败时回滚本地状态并提示错误", async () => {
    bridgeState.pinResult = {
      ok: false,
      error: { status: 401, message: "网页登录已失效" },
    };
    bridgeState.items = [mkItem("a/x"), mkItem("b/y", true)];
    const store = useProjectsStore();

    await store.loadProjects();
    expect(store.pinnedRepos).toEqual(["b/y"]);

    await store.togglePin("b/y"); // 写回失败 → 回滚

    expect(store.pinnedRepos).toEqual(["b/y"]);
    expect(store.pinError).toContain("网页登录已失效");
    expect(
      JSON.parse(localStorage.getItem("cnb-unpinned-server-pins") || "[]")
    ).toEqual([]);
  });
});
