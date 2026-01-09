import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

class MockModel {
  private value: string;
  private listeners: Array<() => void> = [];
  constructor(initial: string) {
    this.value = initial;
  }
  dispose() {}
  getValue() {
    return this.value;
  }
  setValue(v: string) {
    this.value = v;
    this.listeners.forEach((fn) => fn());
  }
  getLineCount() {
    return this.value.length ? this.value.split("\n").length : 1;
  }
  getLineContent(lineNumber: number) {
    const lines = this.value.split("\n");
    return lines[lineNumber - 1] ?? "";
  }
  getLineMaxColumn(lineNumber: number) {
    const line = this.getLineContent(lineNumber);
    return (line?.length ?? 0) + 1;
  }
  getValueInRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) {
    const start = toOffset(
      this.value,
      range.startLineNumber,
      range.startColumn
    );
    const end = toOffset(this.value, range.endLineNumber, range.endColumn);
    return this.value.slice(Math.min(start, end), Math.max(start, end));
  }
  onDidChangeContent(cb: () => void) {
    this.listeners.push(cb);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(cb);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  }
}

function toOffset(text: string, lineNumber: number, column: number) {
  const lines = text.split("\n");
  let offset = 0;
  const ln = Math.max(1, lineNumber);
  const col = Math.max(1, column);
  for (let i = 0; i < ln - 1; i++) offset += (lines[i]?.length ?? 0) + 1;
  offset += col - 1;
  return Math.min(Math.max(offset, 0), text.length);
}

class MockStandaloneEditor {
  private model: MockModel;
  private position = { lineNumber: 1, column: 1 };
  private selection = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  };
  private scrollTop = 0;
  private scrollLeft = 0;
  private scrollListeners: Array<() => void> = [];
  private mouseDownListeners: Array<(e: any) => void> = [];
  public decorations: any[] = [];
  public revealedLine: number | null = null;
  public focused = false;
  constructor(model: MockModel) {
    this.model = model;
  }
  focus() {
    this.focused = true;
  }
  getModel() {
    return this.model as any;
  }
  setModel(model: any) {
    this.model = model as any;
  }
  getPosition() {
    return this.position as any;
  }
  setPosition(pos: { lineNumber: number; column: number }) {
    this.position = pos;
    this.selection = {
      startLineNumber: pos.lineNumber,
      startColumn: pos.column,
      endLineNumber: pos.lineNumber,
      endColumn: pos.column,
    };
  }
  getSelection() {
    return this.selection as any;
  }
  setSelection(sel: any) {
    this.selection = sel;
  }
  onDidScrollChange(cb: () => void) {
    this.scrollListeners.push(cb);
    return {
      dispose: () => {
        const idx = this.scrollListeners.indexOf(cb);
        if (idx >= 0) this.scrollListeners.splice(idx, 1);
      },
    };
  }
  getScrollTop() {
    return this.scrollTop;
  }
  getScrollLeft() {
    return this.scrollLeft;
  }
  getTopForLineNumber(lineNumber: number) {
    const ln = Math.max(1, Number(lineNumber || 1));
    const lineHeight = 18;
    return (ln - 1) * lineHeight;
  }
  setScrollTop(v: number) {
    this.scrollTop = v;
  }
  setScrollLeft(v: number) {
    this.scrollLeft = v;
  }
  triggerScroll() {
    this.scrollListeners.forEach((fn) => fn());
  }
  onMouseDown(cb: (e: any) => void) {
    this.mouseDownListeners.push(cb);
    return {
      dispose: () => {
        const idx = this.mouseDownListeners.indexOf(cb);
        if (idx >= 0) this.mouseDownListeners.splice(idx, 1);
      },
    };
  }
  triggerMouseDown(e: any) {
    this.mouseDownListeners.forEach((fn) => fn(e));
  }
  revealLineInCenter(line: number) {
    this.revealedLine = line;
  }
  layout() {}
  executeEdits(_: string, edits: any[]) {
    const before = this.model.getValue();
    let value = before;
    for (const e of edits) {
      const r = e.range;
      const start = toOffset(value, r.startLineNumber, r.startColumn);
      const end = toOffset(value, r.endLineNumber, r.endColumn);
      value = value.slice(0, start) + String(e.text ?? "") + value.slice(end);
    }
    this.model.setValue(value);
  }
  deltaDecorations(_: string[], next: any[]) {
    this.decorations = next;
    return next.map((_, idx) => `d${idx}`);
  }
}

vi.mock("monaco-editor", () => {
  const editor = {
    createModel: (value: string) => new MockModel(value),
    create: () => new MockStandaloneEditor(new MockModel("")),
    defineTheme: () => {},
    setTheme: () => {},
    MouseTargetType: {
      GUTTER_GLYPH_MARGIN: 2,
    },
  };
  return { editor };
});

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => {
  return { default: class EditorWorker {} };
});
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => {
  return { default: class JsonWorker {} };
});
vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => {
  return { default: class CssWorker {} };
});
vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => {
  return { default: class HtmlWorker {} };
});
vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => {
  return { default: class TsWorker {} };
});

let mergeConflictCb: ((payload: any) => void) | null = null;

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
    mergeStoreMock.logLines.push({ text: String(text ?? ""), error });
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

vi.mock("../src/renderer/ipc/bridge", () => {
  return {
    onMergeConflict: (cb: (payload: any) => void) => {
      mergeConflictCb = cb;
      return () => {
        if (mergeConflictCb === cb) mergeConflictCb = null;
      };
    },
    resolveConflict: vi.fn().mockResolvedValue({ ok: true }),
    openExternal: vi.fn(),
    getFileContent: vi.fn(),
    createCommit: vi.fn(),
    getMergeBase: vi.fn(),
    getMergeRequestChanges: vi.fn().mockResolvedValue({ changes: [] }),
    getMergeRequestConflicts: vi.fn().mockResolvedValue([]),
    getMergeRequestConflictsFull: vi.fn().mockResolvedValue([]),
    getMergeRequest: vi.fn().mockResolvedValue({}),
    getMergeRequestConflictForPath: vi
      .fn()
      .mockResolvedValue({ sections: [{ id: "sec_default" }] }),
    resolveMergeRequestConflicts: vi.fn(),
    localGitPrepareConflicts: vi.fn(),
    localGitGetFileContents: vi.fn(),
    localGitMergeFileContents: vi.fn(),
    localGitCleanup: vi.fn(),
  };
});

beforeEach(() => {
  try {
    globalThis.localStorage?.clear?.();
  } catch {}
  vi.clearAllMocks();
});

afterEach(() => {
  try {
    globalThis.localStorage?.clear?.();
  } catch {}
  vi.useRealTimers();
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

    const originalIpc = (globalThis as any).window?.ipcRenderer;
    (globalThis as any).window.ipcRenderer = {
      on: vi.fn(),
      off: vi.fn(),
      invoke: vi.fn(),
    };

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

    expect(wrapper.text()).toContain("暂无日志输出");

    const logEl = wrapper.find(".modal .log").element as HTMLDivElement;
    Object.defineProperty(logEl, "scrollHeight", {
      configurable: true,
      get: () => 123,
    });
    logEl.scrollTop = 0;

    mergeStoreMock.log("L1");
    mergeStoreMock.log("L2", true);
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("L1");
    expect(wrapper.text()).toContain("L2");
    expect(
      wrapper.findAll(".log-line.err").some((n: any) => n.text().includes("L2"))
    ).toBe(true);
    expect(logEl.scrollTop).toBe(123);

    if (resolveMergeRun)
      (resolveMergeRun as any)({ ok: true, mergedCount: 0, noopCount: 0 });
    await nextTick();

    wrapper.unmount();
    (globalThis as any).window.ipcRenderer = originalIpc;
  });

  it("收到冲突事件时会弹出冲突解决窗口", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const App = (await import("../src/App.vue")).default;

    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          ConflictDialog: {
            props: ["visible", "conflictData"],
            emits: ["close", "resolved"],
            template:
              '<div v-if="visible" class="conflict-stub">{{ conflictData?.mrIid }}</div>',
          },
        },
      },
    });

    expect(mergeConflictCb).toBeTruthy();
    const cb = mergeConflictCb;
    if (!cb) throw new Error("mergeConflictCb missing");
    cb({
      runId: "r1",
      projectId: 1,
      source: "wzp-fix",
      target: "dev",
      mrIid: 1222,
      mrWebUrl: "http://gitlab/mr/1222",
      conflicts: [{ type: "text", new_path: "a.txt" }],
    });

    await nextTick();
    expect(wrapper.find(".conflict-stub").exists()).toBe(true);
    expect(wrapper.find(".conflict-stub").text()).toContain("1222");

    wrapper.unmount();
  });
});

describe("ConflictDialog 交互", () => {
  it("冲突文件列表为空时可确认已在 GitLab 解决并继续检测", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestChanges.mockResolvedValueOnce({
      changes: [{ new_path: "a.txt" }, { new_path: "b.png" }],
    });
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath }: any) => {
        if (filePath === ".gitattributes") return "* -text\n*.png binary\n";
        return "";
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [],
          conflictApiDebug: {
            ok: true,
            method: "GET",
            url: "http://gitlab/api/v4/projects/1/merge_requests/1222/conflicts",
            status: 409,
            requestHeaders: { "PRIVATE-TOKEN": "[REDACTED]" },
            responseHeaders: { "x-request-id": "req1" },
            bodyKeys: ["files"],
          },
          mrDetails: {
            merge_status: "cannot_be_merged",
            detailed_merge_status: "conflicts",
            has_conflicts: true,
            state: "opened",
            changes_count: "2",
          },
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 6; i++) {
      await nextTick();
      await Promise.resolve();
    }
    expect(wrapper.text()).toContain("未找到冲突文件");
    expect(wrapper.text()).toContain("进度: 0 / 0");
    expect(wrapper.text()).toContain("MR 变更文件（供排查）");
    expect(wrapper.text()).toContain("a.txt");
    expect(wrapper.text()).toContain("b.png");
    expect(wrapper.text()).toContain(".gitattributes");
    expect(wrapper.text()).toContain("冲突接口诊断");
    expect(wrapper.text()).toContain("MR 合并状态");
    expect(wrapper.text()).toContain("merge_status=cannot_be_merged");

    const btn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("我已在 GitLab 解决"));
    expect(btn).toBeTruthy();
    await (btn as any).trigger("click");

    expect((bridge as any).resolveConflict).toHaveBeenCalledWith({
      runId: "r1",
      resolution: { resolved: true },
    });
    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("resolved")).toBeTruthy();

    wrapper.unmount();
  });

  it("conflicts 仅1个但全量接口返回4个时应显示4个冲突文件", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestConflictsFull.mockResolvedValueOnce([
      { type: "text", new_path: "a.txt" },
      { type: "text", new_path: "b.txt" },
      { type: "text", new_path: "c.txt" },
      { type: "text", new_path: "d.txt" },
    ]);
    (bridge as any).getFileContent.mockResolvedValue("");
    (bridge as any).getMergeBase.mockResolvedValue(null);

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_full_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1291,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1291",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 120; i++) {
      await nextTick();
      await Promise.resolve();
      if (wrapper.findAll(".conflict-file-row").length === 4) break;
    }

    expect((bridge as any).getMergeRequestConflictsFull).toHaveBeenCalledWith({
      projectId: 1,
      mrIid: 1291,
      mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1291",
    });
    expect(wrapper.findAll(".conflict-file-row").length).toBe(4);
    expect(wrapper.text()).toContain("进度: 1 / 4");

    wrapper.unmount();
  });

  it("visible 从 false 变为 true 时会自动加载首个冲突文件", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    ((bridge as any).getFileContent as any).mockResolvedValue("");
    ((bridge as any).getMergeBase as any).mockResolvedValue(null);

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: false,
        conflictData: {
          runId: "r_visible_1",
          projectId: 1,
          source: "feat",
          target: "dev",
          mrIid: 0,
          conflicts: [{ type: "text", new_path: "src/a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 3; i++) {
      await nextTick();
      await Promise.resolve();
    }

    await wrapper.setProps({ visible: true });

    for (let i = 0; i < 8; i++) {
      await nextTick();
      await Promise.resolve();
    }

    const calls = (((bridge as any).getFileContent as any).mock?.calls ??
      []) as any[];
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.some(
        (c) => c?.[0]?.filePath === "src/a.txt" && c?.[0]?.ref === "dev"
      )
    ).toBe(true);
    expect(
      calls.some(
        (c) => c?.[0]?.filePath === "src/a.txt" && c?.[0]?.ref === "feat"
      )
    ).toBe(true);
    expect(wrapper.text()).toContain("src/a.txt");

    wrapper.unmount();
  });

  it("大量冲突文件时列表可完整渲染且进度正确", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    const bigList = Array.from({ length: 120 }, (_, i) => ({
      type: "text",
      new_path: `src/f_${i + 1}.txt`,
    }));
    (bridge as any).getMergeRequestConflictsFull.mockResolvedValueOnce(bigList);
    (bridge as any).getFileContent.mockResolvedValue("");
    (bridge as any).getMergeBase.mockResolvedValue(null);

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_big_1",
          projectId: 1,
          source: "feat",
          target: "dev",
          mrIid: 1291,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1291",
          conflicts: [{ type: "text", new_path: "src/f_1.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 200; i++) {
      await nextTick();
      await Promise.resolve();
      if (wrapper.findAll(".conflict-file-row").length === 120) break;
    }

    expect(wrapper.findAll(".conflict-file-row").length).toBe(120);
    expect(wrapper.text()).toContain("进度: 1 / 120");

    wrapper.unmount();
  });

  it("特殊字符路径的冲突文件能正确显示", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getFileContent.mockResolvedValue("");
    (bridge as any).getMergeBase.mockResolvedValue(null);

    const fp = "路径/含 空格#%[1]（测试）.js";
    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_special_1",
          projectId: 1,
          source: "feat",
          target: "dev",
          mrIid: 0,
          conflicts: [{ type: "text", new_path: fp }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 6; i++) {
      await nextTick();
      await Promise.resolve();
    }

    expect(wrapper.text()).toContain(fp);
    expect(wrapper.findAll(".conflict-file-row").length).toBe(1);

    wrapper.unmount();
  });

  it("确认合并并提交会把暂存动作转为可克隆的纯对象", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick, reactive } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).createCommit.mockResolvedValueOnce({ ok: true });
    (bridge as any).resolveConflict.mockResolvedValueOnce({ ok: true });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_commit_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          conflicts: [],
        },
      },
      attachTo: document.body,
    });

    await nextTick();
    const setupState = (wrapper.vm as any).$?.setupState || {};
    setupState.pendingActions.value = [
      reactive({ action: "update", file_path: "a.txt", content: "X" }),
    ];

    await setupState.confirmAndCommit();

    expect((bridge as any).createCommit).toHaveBeenCalled();
    const payload = ((bridge as any).createCommit as any).mock.calls[0][0];
    if (typeof (globalThis as any).structuredClone === "function") {
      expect(() =>
        (globalThis as any).structuredClone(payload.actions)
      ).not.toThrow();
    }

    wrapper.unmount();
  });

  it("冲突文件列表为空时可从 MR 变更文件进入三屏三方合并", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestChanges.mockResolvedValueOnce({
      changes: [{ new_path: "a.txt" }],
    });
    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath, ref }: any) => {
        if (filePath === ".gitattributes") return "* -text\n";
        if (filePath === "a.txt" && ref === "baseSha") return "B1\nB2\nB3";
        if (filePath === "a.txt" && ref === "dev") return "L1\nB2\nB3";
        if (filePath === "a.txt" && ref === "wzp-fix") return "B1\nB2\nR3";
        return "";
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_adhoc_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [],
          conflictApiDebug: { ok: false, status: 404 },
          mrDetails: { merge_status: "cannot_be_merged", has_conflicts: true },
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.find(".merge-panes-header").exists()) break;
    }
    expect(wrapper.find(".merge-panes-header").exists()).toBe(true);
    expect(wrapper.text()).toContain("解决冲突: a.txt");
    expect(wrapper.findAll(".conflict-file-row").length).toBe(1);

    expect((bridge as any).getMergeBase).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 1, refs: ["wzp-fix", "dev"] })
    );
    const fileReads = ((bridge as any).getFileContent as any).mock?.calls ?? [];
    expect(
      fileReads.some(
        (c: any[]) => c?.[0]?.filePath === "a.txt" && c?.[0]?.ref === "dev"
      )
    ).toBe(true);
    expect(
      fileReads.some(
        (c: any[]) => c?.[0]?.filePath === "a.txt" && c?.[0]?.ref === "wzp-fix"
      )
    ).toBe(true);
    expect(
      fileReads.some(
        (c: any[]) => c?.[0]?.filePath === "a.txt" && c?.[0]?.ref === "baseSha"
      )
    ).toBe(true);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("从 relatedFiles 自动进入三方合并会携带完整文件列表", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestChanges.mockResolvedValueOnce({
      changes: [
        { new_path: "a.txt" },
        { new_path: "b.txt" },
        { new_path: "c.txt" },
        { new_path: "d.txt" },
      ],
    });
    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath, ref }: any) => {
        if (filePath === ".gitattributes") return "* -text\n";
        if (filePath === "a.txt" && ref === "baseSha") return "B1\nB2\nB3";
        if (filePath === "a.txt" && ref === "dev") return "L1\nB2\nB3";
        if (filePath === "a.txt" && ref === "wzp-fix") return "B1\nB2\nR3";
        return "";
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_adhoc_multi_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [],
          conflictApiDebug: { ok: false, status: 404 },
          mrDetails: { merge_status: "cannot_be_merged", has_conflicts: true },
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 120; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.find(".merge-panes-header").exists()) break;
    }

    expect(wrapper.find(".merge-panes-header").exists()).toBe(true);
    expect(wrapper.text()).toContain("解决冲突: a.txt");
    expect(wrapper.text()).toContain("已选择: 4 / 4");
    expect(wrapper.text()).toContain("b.txt");
    expect(wrapper.text()).toContain("c.txt");
    expect(wrapper.text()).toContain("d.txt");
    expect(wrapper.findAll(".conflict-file-row").length).toBe(4);

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const cf = setupState.conflictFiles?.value ?? setupState.conflictFiles;
    const sp = setupState.selectedPaths?.value ?? setupState.selectedPaths;
    expect(Array.isArray(cf) ? cf.length : 0).toBe(4);
    expect(Array.isArray(sp) ? sp.length : 0).toBe(4);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("冲突文件列表为空时支持本地 Git 检测并加载文件内容", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).localGitPrepareConflicts.mockResolvedValueOnce({
      ok: true,
      conflicts: [{ type: "text", new_path: "a.txt" }],
      baseSha: "baseSha",
    });
    (bridge as any).localGitGetFileContents.mockImplementation(
      async ({ filePath }: any) => {
        if (filePath === "a.txt")
          return {
            ok: true,
            base: "B1\nB2",
            left: "L1\nB2",
            right: "B1\nR2",
            baseSha: "baseSha",
          };
        return { ok: true, base: "", left: "", right: "", baseSha: "baseSha" };
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_local_git_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1222",
          conflicts: [],
          conflictApiDebug: { ok: false, status: 404 },
          mrDetails: { merge_status: "cannot_be_merged", has_conflicts: true },
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 20; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
    }

    expect(wrapper.text()).toContain("未找到冲突文件");
    ((bridge as any).getFileContent as any).mockClear?.();
    const btn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("本地 Git"));
    expect(btn).toBeTruthy();
    await (btn as any).trigger("click");
    for (let i = 0; i < 60; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("a.txt")) break;
    }

    expect((bridge as any).localGitPrepareConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r_local_git_1", projectId: 1 })
    );
    expect((bridge as any).localGitGetFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r_local_git_1", filePath: "a.txt" })
    );
    const gitlabFileReads =
      ((bridge as any).getFileContent as any).mock?.calls ?? [];
    expect(
      gitlabFileReads.some((c: any[]) => c?.[0]?.filePath === "a.txt")
    ).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("标记自动本地 Git 检测时应异步触发并加载冲突文件", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).localGitPrepareConflicts.mockResolvedValueOnce({
      ok: true,
      conflicts: [{ type: "text", new_path: "a.txt" }],
      baseSha: "baseSha",
    });
    (bridge as any).localGitGetFileContents.mockResolvedValueOnce({
      ok: true,
      base: "B1\nB2",
      left: "L1\nB2",
      right: "B1\nR2",
      baseSha: "baseSha",
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_local_git_auto_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1222",
          conflicts: [],
          autoLocalGitDetect: true,
          conflictApiDebug: { ok: false, status: 404 },
          mrDetails: { merge_status: "cannot_be_merged", has_conflicts: true },
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (((bridge as any).localGitPrepareConflicts as any).mock.calls.length)
        break;
    }

    expect((bridge as any).localGitPrepareConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r_local_git_auto_1", projectId: 1 })
    );

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (((bridge as any).localGitGetFileContents as any).mock.calls.length)
        break;
    }

    expect((bridge as any).localGitGetFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r_local_git_auto_1",
        filePath: "a.txt",
      })
    );
    expect(wrapper.text()).toContain("无实际冲突");
    expect(wrapper.text()).toContain("已自动处理");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("Worker 加载失败时应回退主线程统计与自动合并", async () => {
    vi.useFakeTimers();
    const prevWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = function WorkerStub() {} as any;

    vi.resetModules();
    vi.doMock("../src/renderer/workers/conflictWorker?worker", () => {
      return { default: undefined };
    });

    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return "B1\nB2\nB3";
      if (ref === "dev") return "L1\nB2\nB3";
      if (ref === "wzp-fix") return "B1\nB2\nR3";
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_worker_fallback_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1999,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1999",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 120; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("已自动处理")) break;
    }

    expect(wrapper.text()).toContain("已自动处理");

    wrapper.unmount();
    (globalThis as any).Worker = prevWorker;
    vi.useRealTimers();
  });

  it("Worker 无响应时应超时并回退主线程继续统计", async () => {
    vi.useFakeTimers();
    const prevConsoleError = console.error;
    console.error = vi.fn();
    const prevWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = function WorkerStub() {} as any;

    vi.resetModules();
    vi.doMock("../src/renderer/workers/conflictWorker?worker", () => {
      class SilentWorker {
        onmessage: any;
        onerror: any;
        postMessage() {}
        terminate() {}
      }
      return { default: SilentWorker };
    });

    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return "B1\nB2\nB3";
      if (ref === "dev") return "L1\nB2\nB3";
      if (ref === "wzp-fix") return "B1\nB2\nR3";
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_worker_timeout_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 2001,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/2001",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 160; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("已自动处理")) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const scan =
      setupState.conflictCountScan?.value ?? setupState.conflictCountScan;
    expect(scan.running).toBe(false);
    expect(String((console.error as any).mock?.calls ?? [])).toContain(
      "冲突计算 worker 超时"
    );
    expect(wrapper.text()).toContain("已自动处理");

    wrapper.unmount();
    (globalThis as any).Worker = prevWorker;
    console.error = prevConsoleError;
    vi.useRealTimers();
  });

  it("统计期间不渲染冲突文件列表，统计完成后再展示", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;
    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      const text =
        ref === "baseSha"
          ? "B1\nB2\nB3"
          : ref === "dev"
          ? "L1\nB2\nB3"
          : ref === "wzp-fix"
          ? "R1\nB2\nB3"
          : "";
      return await new Promise<string>((resolve) =>
        setTimeout(() => resolve(text), 50)
      );
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_scan_defer_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 0,
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 6; i++) {
      await nextTick();
      await Promise.resolve();
    }

    expect(wrapper.text()).toContain("正在统计冲突块并过滤无冲突文件");
    expect(wrapper.text()).not.toContain("未找到冲突文件");
    expect(wrapper.findAll(".conflict-file-row").length).toBe(0);

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const scan =
      setupState.conflictCountScan?.value ?? setupState.conflictCountScan;
    expect(Boolean(scan?.running)).toBe(true);

    await vi.advanceTimersByTimeAsync(60);
    for (let i = 0; i < 60; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("a.txt")) break;
    }

    const scan2 =
      setupState.conflictCountScan?.value ?? setupState.conflictCountScan;
    expect(Boolean(scan2?.running)).toBe(false);
    expect(wrapper.findAll(".conflict-file-row").length).toBe(1);
    expect(wrapper.text()).toContain("a.txt");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("会基于 conflict_for_path 自动隐藏无实际冲突文件", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestConflictsFull.mockResolvedValueOnce([
      { type: "text", new_path: "src/api/adminIndex.js" },
      { type: "text", new_path: "a.txt" },
    ]);
    (bridge as any).getMergeRequestConflictForPath.mockImplementation(
      async ({ newPath }: any) => {
        if (newPath === "a.txt") return { sections: [{ id: "sec_1" }] };
        return null;
      }
    );
    (bridge as any).getMergeBase.mockResolvedValue(null);

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_conflict_for_path_filter_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 123,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/123",
          conflicts: [],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 120; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("a.txt")) break;
    }

    expect(wrapper.text()).toContain("a.txt");
    expect(wrapper.text()).not.toContain("adminIndex.js");
    expect((bridge as any).getMergeRequestConflictForPath).toHaveBeenCalledWith(
      expect.objectContaining({
        mrIid: 123,
        oldPath: "src/api/adminIndex.js",
        newPath: "src/api/adminIndex.js",
      })
    );
    expect((bridge as any).getMergeRequestConflictForPath).toHaveBeenCalledWith(
      expect.objectContaining({
        mrIid: 123,
        oldPath: "a.txt",
        newPath: "a.txt",
      })
    );

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("conflict_for_path 超时应保守保留文件", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestConflictsFull.mockResolvedValueOnce([
      { type: "text", new_path: "a.txt" },
      { type: "text", new_path: "b.txt" },
    ]);
    (bridge as any).getMergeRequestConflictForPath.mockImplementation(
      async () => {
        return await new Promise(() => {});
      }
    );
    (bridge as any).getMergeBase.mockResolvedValue(null);
    (bridge as any).getFileContent.mockResolvedValue("");

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_conflict_for_path_timeout_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 123,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/123",
          conflicts: [],
        },
      },
      attachTo: document.body,
    });

    await vi.advanceTimersByTimeAsync(12_200);
    for (let i = 0; i < 200; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.findAll(".conflict-file-row").length === 2) break;
    }

    expect(wrapper.findAll(".conflict-file-row").length).toBe(2);
    expect(wrapper.text()).toContain("a.txt");
    expect(wrapper.text()).toContain("b.txt");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("conflict_for_path 抛错应保守保留文件", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeRequestConflictsFull.mockResolvedValueOnce([
      { type: "text", new_path: "a.txt" },
      { type: "text", new_path: "b.txt" },
    ]);
    (bridge as any).getMergeRequestConflictForPath.mockImplementation(
      async () => {
        throw new Error("mock error");
      }
    );
    (bridge as any).getMergeBase.mockResolvedValue(null);
    (bridge as any).getFileContent.mockResolvedValue("");

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_conflict_for_path_throw_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 123,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/123",
          conflicts: [],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 200; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.findAll(".conflict-file-row").length === 2) break;
    }

    expect(wrapper.findAll(".conflict-file-row").length).toBe(2);
    expect(wrapper.text()).toContain("a.txt");
    expect(wrapper.text()).toContain("b.txt");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("可通过 GitLab resolve_conflicts 提交（按文件选择 head/origin）", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    const originalAlert = (globalThis as any).alert;
    (globalThis as any).alert = vi.fn();

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return "B1\nB2\nB3";
      if (ref === "dev") return "L1\nL2\nL3";
      if (ref === "wzp-fix") return "R1\nR2\nR3";
      return "";
    });
    (bridge as any).getMergeRequestConflictForPath.mockResolvedValueOnce({
      sections: [{ id: "sec_1" }, { id: "sec_2" }],
    });
    (bridge as any).resolveMergeRequestConflicts.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ok: true },
    });
    (bridge as any).resolveConflict.mockResolvedValueOnce({ ok: true });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_gitlab_resolve_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1291,
          mrWebUrl: "http://172.16.43.4:30085/group/proj/-/merge_requests/1291",
          conflicts: [{ type: "text", new_path: "src/api/activity.js" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loading = setupState.loading?.value ?? setupState.loading;
      const middleEditor =
        setupState.middleEditor?.value ?? setupState.middleEditor;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    (bridge as any).resolveConflict.mockClear?.();
    (bridge as any).getMergeRequestConflictForPath.mockClear?.();
    (bridge as any).resolveMergeRequestConflicts.mockClear?.();

    const acceptBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text().trim() === "接受本地更改");
    expect(acceptBtn).toBeTruthy();
    await (acceptBtn as any).trigger("click");

    if (setupState.commitMessage?.value != null)
      setupState.commitMessage.value = "解决 activity 冲突";
    else setupState.commitMessage = "解决 activity 冲突";

    if (setupState.finalConfirmVisible?.value != null)
      setupState.finalConfirmVisible.value = true;
    else setupState.finalConfirmVisible = true;

    await nextTick();

    await setupState.confirmAndResolveConflicts();

    expect((bridge as any).getMergeRequestConflictForPath).toHaveBeenCalledWith(
      expect.objectContaining({
        mrWebUrl: "http://172.16.43.4:30085/group/proj/-/merge_requests/1291",
        mrIid: 1291,
        oldPath: "src/api/activity.js",
        newPath: "src/api/activity.js",
      })
    );

    expect((bridge as any).resolveMergeRequestConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        mrWebUrl: "http://172.16.43.4:30085/group/proj/-/merge_requests/1291",
        mrIid: 1291,
        commit_message: "解决 activity 冲突",
        files: [
          {
            old_path: "src/api/activity.js",
            new_path: "src/api/activity.js",
            sections: { sec_1: "origin", sec_2: "origin" },
          },
        ],
      })
    );

    expect((bridge as any).resolveConflict).toHaveBeenCalledWith({
      runId: "r_gitlab_resolve_1",
      resolution: { resolved: true },
    });

    wrapper.unmount();
    (globalThis as any).alert = originalAlert;
    vi.useRealTimers();
  });

  it("切换“源分支对应 head”会改变 local/remote 到 head/origin 的映射", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    const originalAlert = (globalThis as any).alert;
    (globalThis as any).alert = vi.fn();

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return "B1\nB2\nB3";
      if (ref === "dev") return "L1\nL2\nL3";
      if (ref === "wzp-fix") return "R1\nR2\nR3";
      return "";
    });
    (bridge as any).getMergeRequestConflictForPath.mockResolvedValueOnce({
      sections: [{ id: "sec_1" }],
    });
    (bridge as any).resolveMergeRequestConflicts.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ok: true },
    });
    (bridge as any).resolveConflict.mockResolvedValueOnce({ ok: true });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_gitlab_resolve_map_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1291,
          mrWebUrl: "http://172.16.43.4:30085/group/proj/-/merge_requests/1291",
          conflicts: [{ type: "text", new_path: "src/api/activity.js" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loading = setupState.loading?.value ?? setupState.loading;
      const middleEditor =
        setupState.middleEditor?.value ?? setupState.middleEditor;
      if (loading === false && middleEditor) break;
    }

    const acceptBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text().trim() === "接受本地更改");
    expect(acceptBtn).toBeTruthy();
    await (acceptBtn as any).trigger("click");

    const setupState = (wrapper.vm as any).$?.setupState || {};
    (bridge as any).resolveConflict.mockClear?.();
    (bridge as any).getMergeRequestConflictForPath.mockClear?.();
    (bridge as any).resolveMergeRequestConflicts.mockClear?.();

    if (setupState.commitMessage?.value != null)
      setupState.commitMessage.value = "映射切换测试";
    else setupState.commitMessage = "映射切换测试";

    if (setupState.sourceMapsToHead?.value != null)
      setupState.sourceMapsToHead.value = false;
    else setupState.sourceMapsToHead = false;

    await nextTick();
    await setupState.confirmAndResolveConflicts();

    expect((bridge as any).resolveMergeRequestConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            new_path: "src/api/activity.js",
            sections: { sec_1: "head" },
          }),
        ],
      })
    );

    expect((bridge as any).resolveConflict).toHaveBeenCalledWith({
      runId: "r_gitlab_resolve_map_1",
      resolution: { resolved: true },
    });

    wrapper.unmount();
    (globalThis as any).alert = originalAlert;
    vi.useRealTimers();
  });

  it("本地 Git 检测返回多文件时应全部展示并默认全选", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).localGitPrepareConflicts.mockResolvedValueOnce({
      ok: true,
      conflicts: [
        { type: "text", new_path: "a.txt" },
        { type: "text", new_path: "b.txt" },
        { type: "text", new_path: "c.txt" },
        { type: "text", new_path: "d.txt" },
      ],
      baseSha: "baseSha",
    });
    (bridge as any).localGitGetFileContents.mockImplementation(
      async ({ filePath }: any) => {
        if (filePath === "a.txt")
          return {
            ok: true,
            base: "B1\nB2",
            left: "L1\nB2",
            right: "B1\nR2",
            baseSha: "baseSha",
          };
        return {
          ok: true,
          base: "B",
          left: "L",
          right: "R",
          baseSha: "baseSha",
        };
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_local_git_multi_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1222",
          conflicts: [],
          conflictApiDebug: { ok: false, status: 404 },
          mrDetails: { merge_status: "cannot_be_merged", has_conflicts: true },
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 20; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
    }

    expect(wrapper.text()).toContain("未找到冲突文件");
    const btn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("本地 Git"));
    expect(btn).toBeTruthy();
    await (btn as any).trigger("click");

    for (let i = 0; i < 120; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("已选择: 3 / 3")) break;
    }

    expect(wrapper.text()).toContain("已选择: 3 / 3");
    expect(wrapper.text()).toContain("进度: 1 / 3");
    expect(wrapper.text()).toContain("已自动处理无冲突文件");
    expect(wrapper.text()).not.toContain("a.txt");
    expect(wrapper.text()).toContain("b.txt");
    expect(wrapper.text()).toContain("c.txt");
    expect(wrapper.text()).toContain("d.txt");

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const cf = setupState.conflictFiles?.value ?? setupState.conflictFiles;
    const sp = setupState.selectedPaths?.value ?? setupState.selectedPaths;
    const ap =
      setupState.autoProcessedFiles?.value ?? setupState.autoProcessedFiles;
    expect(Array.isArray(cf) ? cf.length : 0).toBe(3);
    expect(Array.isArray(sp) ? sp.length : 0).toBe(3);
    expect(Array.isArray(ap) ? ap.length : 0).toBe(1);

    const showAllBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("显示所有文件"));
    expect(showAllBtn).toBeTruthy();
    await (showAllBtn as any).trigger("click");

    for (let i = 0; i < 20; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("a.txt")) break;
    }
    expect(wrapper.text()).toContain("a.txt");

    const showConflictsOnlyBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("仅显示冲突文件"));
    expect(showConflictsOnlyBtn).toBeTruthy();
    await (showConflictsOnlyBtn as any).trigger("click");

    for (let i = 0; i < 20; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (!wrapper.text().includes("a.txt")) break;
    }
    expect(wrapper.text()).not.toContain("a.txt");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("二进制候选文件已知冲突块为0时应保持并被过滤", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValueOnce("baseSha");
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath, ref }: any) => {
        if (filePath === "b.txt") {
          if (ref === "baseSha") return "B1\nB2";
          if (ref === "dev") return "L1\nB2";
          if (ref === "wzp-fix") return "R1\nB2";
        }
        return "";
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_zero_binary_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 0,
          conflicts: [
            { type: "text", new_path: "a.png", conflict_block_count: 0 },
            { type: "text", new_path: "b.txt" },
          ],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 120; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const scan =
        setupState.conflictCountScan?.value ?? setupState.conflictCountScan;
      const scanTotal = Number(scan?.total ?? 0);
      const scanDone = Number(scan?.done ?? 0);
      const scanRunning = Boolean(scan?.running);
      if (scanTotal === 2 && scanDone === 2 && scanRunning === false) break;
    }

    expect(wrapper.text()).toContain("b.txt");

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const cf = setupState.conflictFiles?.value ?? setupState.conflictFiles;
    const sp = setupState.selectedPaths?.value ?? setupState.selectedPaths;
    const all =
      setupState.allConflictFiles?.value ?? setupState.allConflictFiles;

    expect(Array.isArray(cf) ? cf.length : 0).toBe(1);
    expect(Array.isArray(sp) ? sp.length : 0).toBe(1);
    expect(Array.isArray(all) ? all.length : 0).toBe(2);

    const a = (Array.isArray(all) ? all : []).find(
      (x: any) => x?.new_path === "a.png"
    );
    expect(a).toBeTruthy();
    expect((a as any).conflict_block_state).toBe("binary");
    expect((a as any).conflict_block_count).toBe(0);

    const rows1 = wrapper.findAll(".conflict-file-row");
    expect(rows1.length).toBe(1);
    expect(rows1[0].text()).toContain("b.txt");

    const showAllBtn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("显示所有文件"));
    expect(showAllBtn).toBeTruthy();
    await (showAllBtn as any).trigger("click");

    for (let i = 0; i < 20; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.findAll(".conflict-file-row").length === 2) break;
    }

    const rows2 = wrapper.findAll(".conflict-file-row");
    expect(rows2.length).toBe(2);
    expect(rows2.some((r: any) => r.text().includes("a.png"))).toBe(true);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("支持 Git 三方合并按钮并调用本地 merge-file 接口", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValueOnce("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return "B1\nB2\nB3";
      if (ref === "dev") return "B1\nL2\nB3";
      if (ref === "wzp-fix") return "B1\nR2\nB3";
      return "";
    });
    (bridge as any).localGitMergeFileContents.mockResolvedValueOnce({
      ok: true,
      merged: "MERGED",
      hasConflicts: false,
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r_git_merge_1",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/group/proj/-/merge_requests/1222",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 40; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (wrapper.text().includes("a.txt")) break;
    }

    const btn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("Git 三方合并"));
    expect(btn).toBeTruthy();
    await (btn as any).trigger("click");

    for (let i = 0; i < 40; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      if (((bridge as any).localGitMergeFileContents as any).mock.calls.length)
        break;
    }

    expect((bridge as any).localGitMergeFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        left: expect.any(String),
        base: expect.any(String),
        right: expect.any(String),
      })
    );

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("冲突文件列表为空时可取消合并并结束等待", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r2",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          conflicts: [],
        },
      },
      attachTo: document.body,
    });

    await nextTick();
    const btn = wrapper
      .findAll("button")
      .find((b: any) => b.text().includes("取消合并"));
    expect(btn).toBeTruthy();
    await (btn as any).trigger("click");

    expect((bridge as any).resolveConflict).toHaveBeenCalledWith({
      runId: "r2",
      resolution: { resolved: false },
    });
    expect(wrapper.emitted("close")).toBeTruthy();

    wrapper.unmount();
  });

  it("切换冲突文件后保留各文件的编辑与撤销栈", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath, ref }: any) => {
        if (ref === "baseSha") return `BASE:${filePath}`;
        if (ref === "wzp-fix") return `SRC:${filePath}`;
        if (ref === "dev") return `TGT:${filePath}`;
        return "";
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r3",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [
            { type: "text", new_path: "a.txt" },
            { type: "text", new_path: "b.txt" },
          ],
        },
      },
      attachTo: document.body,
    });

    const setupState = (wrapper.vm as any).$?.setupState || {};
    for (let i = 0; i < 60; i++) {
      await nextTick();
      await Promise.resolve();
      const loadingRef = setupState.loading;
      const currentFileRef = setupState.currentFile;
      const middleEditorRef = setupState.middleEditor;
      const loading = loadingRef?.value ?? loadingRef;
      const currentPath = (currentFileRef?.value ?? currentFileRef)?.new_path;
      const middleEditor = middleEditorRef?.value ?? middleEditorRef;
      if (loading === false && currentPath === "a.txt" && middleEditor) break;
    }
    const middleEditorReady =
      setupState.middleEditor?.value ?? setupState.middleEditor;
    expect(middleEditorReady).toBeTruthy();

    const acceptBoth = setupState.acceptBothBranches as any;
    expect(typeof acceptBoth).toBe("function");
    acceptBoth();
    await nextTick();

    const fileStatesRef0 = setupState.fileStates;
    const fileStates0 = fileStatesRef0?.value ?? fileStatesRef0;
    const middleEditor0 = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    const resultModel0 = middleEditor0?.getModel?.();
    expect(resultModel0?.getValue?.()).toContain("<<<<<<< 本地版本 (dev)");
    expect(fileStates0["a.txt"].content).toContain("<<<<<<< 本地版本 (dev)");

    const markResolved = setupState.markResolved as any;
    expect(typeof markResolved).toBe("function");
    await markResolved();

    for (let i = 0; i < 60; i++) {
      await nextTick();
      await Promise.resolve();
      const loadingRef = setupState.loading;
      const currentFileRef = setupState.currentFile;
      const loading = loadingRef?.value ?? loadingRef;
      const currentPath = (currentFileRef?.value ?? currentFileRef)?.new_path;
      if (loading === false && currentPath === "b.txt") break;
    }

    expect(wrapper.text()).toContain("已暂存: 1");
    expect(wrapper.text()).toContain("解决冲突: b.txt");

    const fileStatesRef = setupState.fileStates;
    const fileStates = fileStatesRef?.value ?? fileStatesRef;
    expect(fileStates["a.txt"].content).toContain("<<<<<<< 本地版本 (dev)");
    expect(fileStates["a.txt"].undo.length).toBeGreaterThan(0);

    const bStateBefore = (fileStatesRef?.value ?? fileStatesRef)["b.txt"];
    const undoBefore = bStateBefore?.undo?.length ?? 0;
    const acceptTarget = setupState.acceptTargetBranch as any;
    expect(typeof acceptTarget).toBe("function");
    const bContentBeforeAccept = bStateBefore?.content;
    acceptTarget();

    const bStateAfterAccept = (fileStatesRef?.value ?? fileStatesRef)["b.txt"];
    expect(bStateAfterAccept.undo.length).toBe(undoBefore + 1);
    expect(bStateAfterAccept.content).not.toBe(bContentBeforeAccept);
    const undoEdit = setupState.undoEdit as any;
    expect(typeof undoEdit).toBe("function");
    undoEdit();

    const fileStates2 = (fileStatesRef?.value ?? fileStatesRef) as any;
    expect(fileStates2["b.txt"].content).toBe(bContentBeforeAccept);

    wrapper.unmount();
  });

  it("冲突文件列表支持多选与全选/全不选", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath, ref }: any) => {
        if (ref === "baseSha") return `BASE:${filePath}`;
        if (ref === "wzp-fix") return `SRC:${filePath}`;
        if (ref === "dev") return `TGT:${filePath}`;
        return "";
      }
    );

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r4",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [
            { type: "text", new_path: "a.txt" },
            { type: "text", new_path: "b.txt" },
          ],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 20; i++) {
      await nextTick();
      await Promise.resolve();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const checks = wrapper.findAll('input[type="checkbox"]');
      if (checks.length === 2) break;
    }

    const checks = wrapper.findAll('input[type="checkbox"]');
    expect(checks.length).toBe(2);

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const selectNone = setupState.selectNone as any;
    expect(typeof selectNone).toBe("function");
    selectNone();
    await nextTick();
    const selectedLen1 =
      (setupState.selectedPaths?.value ?? setupState.selectedPaths)?.length ??
      0;
    expect(selectedLen1).toBe(0);

    const selectAll = setupState.selectAll as any;
    expect(typeof selectAll).toBe("function");
    selectAll();
    await nextTick();

    const selectedLen2 =
      (setupState.selectedPaths?.value ?? setupState.selectedPaths)?.length ??
      0;
    expect(selectedLen2).toBe(2);

    wrapper.unmount();
  });

  it("未选择任何文件时禁止完成并提示选择", async () => {
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(
      async ({ filePath, ref }: any) => {
        if (ref === "baseSha") return `BASE:${filePath}`;
        if (ref === "wzp-fix") return `SRC:${filePath}`;
        if (ref === "dev") return `TGT:${filePath}`;
        return "";
      }
    );

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r5",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [
            { type: "text", new_path: "a.txt" },
            { type: "text", new_path: "b.txt" },
          ],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 40; i++) {
      await nextTick();
      await Promise.resolve();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loadingRef = setupState.loading;
      const loading = loadingRef?.value ?? loadingRef;
      const middleEditorRef = setupState.middleEditor;
      const middleEditor = middleEditorRef?.value ?? middleEditorRef;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const selectNone = setupState.selectNone as any;
    expect(typeof selectNone).toBe("function");
    selectNone();
    await nextTick();
    const markResolved = setupState.markResolved as any;
    expect(typeof markResolved).toBe("function");
    await markResolved();

    expect(alertSpy).toHaveBeenCalled();

    alertSpy.mockRestore();
    wrapper.unmount();
  });

  it("支持快捷键替换当前行为本地/远程，且不会越界崩溃", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `B1\nB2\nB3`;
      if (ref === "dev") return `L1\nL2\nL3`;
      if (ref === "wzp-fix") return `R1\nR2\nR3`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r7",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loadingRef = setupState.loading;
      const middleEditorRef = setupState.middleEditor;
      const loading = loadingRef?.value ?? loadingRef;
      const middleEditor = middleEditorRef?.value ?? middleEditorRef;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    const leftEditor = (setupState.leftEditor?.value ??
      setupState.leftEditor) as any;
    const rightEditor = (setupState.rightEditor?.value ??
      setupState.rightEditor) as any;

    const model = middleEditor.getModel();
    expect(model.getValue()).toBe("B1\nB2\nB3");

    middleEditor.setPosition({ lineNumber: 2, column: 1 });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", ctrlKey: true })
    );
    await nextTick();
    expect(model.getValue()).toBe("B1\nL2\nB3");

    middleEditor.setPosition({ lineNumber: 3, column: 1 });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", ctrlKey: true })
    );
    await nextTick();
    expect(model.getValue()).toBe("B1\nL2\nR3");

    middleEditor.setPosition({ lineNumber: 99, column: 1 });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", ctrlKey: true })
    );
    await nextTick();
    expect(model.getValue()).toBe("B1\nL2\nR3");

    expect((leftEditor as any).getModel?.().getValue?.()).toBe("L1\nL2\nL3");
    expect((rightEditor as any).getModel?.().getValue?.()).toBe("R1\nR2\nR3");

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("支持快捷键替换选区为本地/远程，含反向选区", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `B1\nB2\nB3`;
      if (ref === "dev") return `L1\nL2\nL3`;
      if (ref === "wzp-fix") return `R1\nR2\nR3`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r8",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loadingRef = setupState.loading;
      const middleEditorRef = setupState.middleEditor;
      const loading = loadingRef?.value ?? loadingRef;
      const middleEditor = middleEditorRef?.value ?? middleEditorRef;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    const model = middleEditor.getModel();
    expect(model.getValue()).toBe("B1\nB2\nB3");

    middleEditor.setSelection({
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 1,
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", shiftKey: true, ctrlKey: true })
    );
    await nextTick();
    expect(model.getValue()).toBe("B1\nL2\nL3");

    middleEditor.setSelection({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 1,
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", shiftKey: true, ctrlKey: true })
    );
    await nextTick();
    expect(model.getValue()).toBe("R1\nR2\nR3");

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("支持 F7 / Shift+F7 跳转冲突位置", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `B1\nB2\nB3`;
      if (ref === "dev") return `B1\nL2\nL3`;
      if (ref === "wzp-fix") return `B1\nR2\nR3`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r9",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loading = setupState.loading?.value ?? setupState.loading;
      const middleEditor =
        setupState.middleEditor?.value ?? setupState.middleEditor;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;

    middleEditor.setPosition({ lineNumber: 1, column: 1 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7" }));
    await nextTick();
    expect(middleEditor.revealedLine).toBe(2);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7" }));
    await nextTick();
    expect(middleEditor.revealedLine).toBe(3);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F7" }));
    await nextTick();
    expect(middleEditor.revealedLine).toBe(2);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F7", shiftKey: true })
    );
    await nextTick();
    expect(middleEditor.revealedLine).toBe(3);

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("支持 WebStorm 常见快捷键应用左/右（Mac/Win）", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `B1\nB2\nB3`;
      if (ref === "dev") return `B1\nL2\nB3`;
      if (ref === "wzp-fix") return `B1\nR2\nB3`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r10",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loading = setupState.loading?.value ?? setupState.loading;
      const middleEditor =
        setupState.middleEditor?.value ?? setupState.middleEditor;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    const model = middleEditor.getModel();

    const oldPlatform = (navigator as any).platform;
    try {
      Object.defineProperty(navigator, "platform", {
        value: "Win32",
        configurable: true,
      });
      middleEditor.setPosition({ lineNumber: 2, column: 1 });
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          altKey: true,
          shiftKey: true,
        })
      );
      await nextTick();
      expect(model.getValue()).toBe("B1\nL2\nB3");

      Object.defineProperty(navigator, "platform", {
        value: "MacIntel",
        configurable: true,
      });
      middleEditor.setPosition({ lineNumber: 2, column: 1 });
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          ctrlKey: true,
          shiftKey: true,
        })
      );
      await nextTick();
      expect(model.getValue()).toBe("B1\nR2\nB3");
    } finally {
      Object.defineProperty(navigator, "platform", {
        value: oldPlatform,
        configurable: true,
      });
    }

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("自动合并非重叠修改到结果面板", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `A\nB\nC`;
      if (ref === "dev") return `A\nBX\nC`;
      if (ref === "wzp-fix") return `A\nB\nCY`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r11",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const ap =
        setupState.autoProcessedFiles?.value ?? setupState.autoProcessedFiles;
      if (Array.isArray(ap) && ap.length === 1) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const cf = setupState.conflictFiles?.value ?? setupState.conflictFiles;
    const pa = setupState.pendingActions?.value ?? setupState.pendingActions;
    expect(Array.isArray(cf) ? cf.length : 0).toBe(0);
    expect(Array.isArray(pa) ? pa.length : 0).toBe(1);
    expect(pa?.[0]?.file_path).toBe("a.txt");
    expect(pa?.[0]?.content).toBe("A\nBX\nCY");
    expect(wrapper.text()).toContain("无实际冲突");

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("检测插入型冲突并可按块应用左/右", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `A\nB\nC`;
      if (ref === "dev") return `A\nX\nB\nC`;
      if (ref === "wzp-fix") return `A\nY\nB\nC`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r12",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loading = setupState.loading?.value ?? setupState.loading;
      const middleEditor =
        setupState.middleEditor?.value ?? setupState.middleEditor;
      if (loading === false && middleEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    const model = middleEditor.getModel();

    expect(model.getValue()).toBe("A\nB\nC");
    const btn = wrapper.find(".webstorm-merge-btn");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    await nextTick();
    expect(model.getValue()).toBe("A\nX\nB\nC");

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("三屏滚动保持同步", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `B1\nB2\nB3\nB4\nB5`;
      if (ref === "dev") return `L1\nL2\nL3\nL4\nL5`;
      if (ref === "wzp-fix") return `R1\nR2\nR3\nR4\nR5`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r9",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loadingRef = setupState.loading;
      const loading = loadingRef?.value ?? loadingRef;
      const leftEditor = setupState.leftEditor?.value ?? setupState.leftEditor;
      const middleEditor =
        setupState.middleEditor?.value ?? setupState.middleEditor;
      const rightEditor =
        setupState.rightEditor?.value ?? setupState.rightEditor;
      if (loading === false && leftEditor && middleEditor && rightEditor) break;
    }

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const leftEditor = (setupState.leftEditor?.value ??
      setupState.leftEditor) as any;
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    const rightEditor = (setupState.rightEditor?.value ??
      setupState.rightEditor) as any;

    leftEditor.setScrollTop(123);
    leftEditor.setScrollLeft(7);
    leftEditor.triggerScroll();
    expect(middleEditor.getScrollTop()).toBe(123);
    expect(rightEditor.getScrollTop()).toBe(123);
    expect(middleEditor.getScrollLeft()).toBe(7);
    expect(rightEditor.getScrollLeft()).toBe(7);

    middleEditor.setScrollTop(9);
    middleEditor.setScrollLeft(3);
    middleEditor.triggerScroll();
    expect(leftEditor.getScrollTop()).toBe(9);
    expect(rightEditor.getScrollTop()).toBe(9);
    expect(leftEditor.getScrollLeft()).toBe(3);
    expect(rightEditor.getScrollLeft()).toBe(3);

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("点击冲突标记可导航到对应行并聚焦编辑器", async () => {
    vi.useFakeTimers();
    const { mount } = await import("@vue/test-utils");
    const { nextTick } = await import("vue");
    const bridge = await import("../src/renderer/ipc/bridge");
    const ConflictDialog = (
      await import("../src/renderer/components/ConflictDialog.vue")
    ).default;

    (bridge as any).getMergeBase.mockResolvedValue("baseSha");
    (bridge as any).getFileContent.mockImplementation(async ({ ref }: any) => {
      if (ref === "baseSha") return `B1\nB2\nB3`;
      if (ref === "dev") return `B1\nL2\nB3`;
      if (ref === "wzp-fix") return `B1\nR2\nB3`;
      return "";
    });

    const wrapper = mount(ConflictDialog as any, {
      props: {
        visible: true,
        conflictData: {
          runId: "r10",
          projectId: 1,
          source: "wzp-fix",
          target: "dev",
          mrIid: 1222,
          mrWebUrl: "http://gitlab/mr/1222",
          conflicts: [{ type: "text", new_path: "a.txt" }],
        },
      },
      attachTo: document.body,
    });

    for (let i = 0; i < 80; i++) {
      await nextTick();
      await Promise.resolve();
      await vi.runOnlyPendingTimersAsync();
      const setupState = (wrapper.vm as any).$?.setupState || {};
      const loadingRef = setupState.loading;
      const middleEditorRef = setupState.middleEditor;
      const loading = loadingRef?.value ?? loadingRef;
      const middleEditor = middleEditorRef?.value ?? middleEditorRef;
      if (loading === false && middleEditor) break;
    }

    await vi.runOnlyPendingTimersAsync();

    const setupState = (wrapper.vm as any).$?.setupState || {};
    const middleEditor = (setupState.middleEditor?.value ??
      setupState.middleEditor) as any;
    expect(middleEditor).toBeTruthy();

    middleEditor.triggerMouseDown({
      target: {
        position: { lineNumber: 2 },
        type: 2,
      },
    });

    expect(middleEditor.revealedLine).toBe(2);
    expect(middleEditor.getPosition().lineNumber).toBe(2);
    expect(middleEditor.focused).toBe(true);

    vi.useRealTimers();
    wrapper.unmount();
  });
});
