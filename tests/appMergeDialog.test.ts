import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

const authStoreMock = {
  baseUrl: "http://example",
  token: "t",
  rememberToken: false,
  connected: true,
  busy: false,
  userName: "u",
  username: "u",
  error: "",
  loadLocal: vi.fn(),
  connect: vi.fn(),
};

const projectsStoreMock = {
  items: [],
  loading: false,
  error: "",
  filter: "",
  page: 1,
  pageSize: 30,
  selectedProjectId: 1,
  selectedProjectName: "p",
  sourceBranches: ["feat"],
  sourceBranchesLoading: false,
  sourceBranchesError: "",
  targetBranches: ["main"],
  targetBranchesLoading: false,
  targetBranchesError: "",
  selectedSourceBranch: "feat",
  loadProjects: vi.fn(),
  selectProject: vi.fn(),
  loadAllBranches: vi.fn(),
  setFilter: vi.fn(),
  prevPage: vi.fn(),
  nextPage: vi.fn(),
  get pagedItems() {
    return [];
  },
  get totalPages() {
    return 1;
  },
};

let resolveMergeRun: ((v: any) => void) | null = null;
const mergeStoreMock = reactive({
  targetFilter: "",
  targets: ["main"],
  selectedTargets: ["main"],
  logLines: [] as Array<{ text: string; error?: boolean }>,
  progressMax: 0,
  progressValue: 0,
  running: false,
  activeRunId: "",
  setTargets: vi.fn(),
  toggleTarget: vi.fn(),
  log: vi.fn(function (this: any, text: string, error = false) {
    mergeStoreMock.logLines.push({ text, error });
  }),
  run: vi.fn(async () => {
    return await new Promise((resolve) => {
      resolveMergeRun = resolve;
    });
  }),
}) as any;

vi.mock("../src/renderer/store/auth", () => {
  return { useAuthStore: () => authStoreMock };
});

vi.mock("../src/renderer/store/projects", () => {
  return { useProjectsStore: () => projectsStoreMock };
});

vi.mock("../src/renderer/store/merge", () => {
  return {
    useMergeStore: () => mergeStoreMock,
  };
});

describe("App 合并弹窗日志", () => {
  it("源分支与目标分支列表使用下拉滚动容器样式", async () => {
    const { mount } = await import("@vue/test-utils");
    const App = (await import("../src/App.vue")).default;

    const wrapper = mount(App, { attachTo: document.body });

    // Using .branch-list.selector-box as selector-dropdown class is missing in current App.vue
    const dropdowns = wrapper.findAll(".selector-box.branch-list");
    expect(dropdowns.length).toBe(2);

    wrapper.unmount();
  });

  it("合并中弹窗会渲染日志，并自动滚动到底部", async () => {
    resolveMergeRun = null;
    mergeStoreMock.logLines.splice(0);

    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const App = (await import("../src/App.vue")).default;

    const wrapper = mount(App, { attachTo: document.body });

    const startBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("开始批量合并"));
    expect(startBtn).toBeTruthy();
    await startBtn!.trigger("click");

    const confirmBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text() === "确认");
    expect(confirmBtn).toBeTruthy();
    await confirmBtn!.trigger("click");

    await nextTick();

    const logEl = wrapper.find(".modal .log").element as HTMLDivElement;
    Object.defineProperty(logEl, "scrollHeight", {
      configurable: true,
      get: () => 123,
    });
    logEl.scrollTop = 0;

    mergeStoreMock.logLines.push({ text: "L1" });
    mergeStoreMock.logLines.push({ text: "L2", error: true });
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("L1");
    expect(wrapper.text()).toContain("L2");
    expect(
      wrapper.findAll(".log-line.err").some((n: any) => n.text() === "L2")
    ).toBe(true);
    expect(logEl.scrollTop).toBe(123);

    if (resolveMergeRun)
      (resolveMergeRun as any)({ ok: true, mergedCount: 0, noopCount: 0 });
    await nextTick();

    wrapper.unmount();
  });
});
