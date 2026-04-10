import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, defineComponent, h, nextTick } from 'vue'

let mergeConflictCb: ((payload: any) => void) | null = null

const flowDialogSpies = {
  openConfirm: vi.fn(),
  confirmRun: vi.fn(async () => {}),
  closeAll: vi.fn(),
}

const authStoreMock = {
  baseUrl: 'http://example.com',
  token: 'token',
  rememberToken: false,
  connected: true,
  busy: false,
  userName: 'tester',
  username: 'tester',
  error: '',
  loadLocal: vi.fn(),
  connect: vi.fn(),
}

const projectsStoreMock = reactive({
  items: [],
  loading: false,
  error: '',
  filter: '',
  page: 1,
  pageSize: 30,
  selectedProjectId: 1,
  selectedProjectName: 'demo-project',
  sourceBranches: ['feat/test'],
  sourceBranchesLoading: false,
  sourceBranchesError: '',
  targetBranches: ['dev'],
  targetBranchesLoading: false,
  targetBranchesError: '',
  selectedSourceBranch: 'feat/test',
  loadProjects: vi.fn(),
  selectProject: vi.fn(),
  loadAllBranches: vi.fn(),
  setFilter: vi.fn(),
  prevPage: vi.fn(),
  nextPage: vi.fn(),
  get filteredItems() {
    return this.items
  },
  get pagedItems() {
    return []
  },
  get totalPages() {
    return 1
  },
}) as any

const mergeStoreMock = reactive({
  targetFilter: '',
  targets: ['dev'],
  selectedTargets: ['dev'],
  logLines: [] as Array<{ text: string; error?: boolean }>,
  running: false,
  activeRunId: '',
  setTargets: vi.fn(),
  toggleTarget: vi.fn(),
  log: vi.fn(),
  run: vi.fn(async () => ({ ok: true, mergedCount: 1, noopCount: 0 })),
}) as any

vi.mock('../src/renderer/store/auth', () => ({
  useAuthStore: () => authStoreMock,
}))

vi.mock('../src/renderer/store/projects', () => ({
  useProjectsStore: () => projectsStoreMock,
}))

vi.mock('../src/renderer/store/merge', () => ({
  useMergeStore: () => mergeStoreMock,
}))

vi.mock('../src/renderer/ipc/bridge', () => ({
  onMergeConflict: (cb: (payload: any) => void) => {
    mergeConflictCb = cb
    return () => {
      if (mergeConflictCb === cb) mergeConflictCb = null
    }
  },
}))

vi.mock('../src/renderer/components/BatchMergeFlowDialog.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'BatchMergeFlowDialog',
    setup(_, { expose }) {
      expose(flowDialogSpies)
      return () => h('div', { 'data-testid': 'batch-flow-dialog' })
    },
  }),
}))

vi.mock('../src/renderer/components/ConflictDialog.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'ConflictDialog',
    emits: ['close', 'resolved'],
    setup(_, { emit }) {
      return () =>
        h('div', { 'data-testid': 'conflict-dialog' }, [
          h(
            'button',
            {
              'data-testid': 'emit-resolved',
              onClick: () => emit('resolved'),
            },
            'resolved',
          ),
          h(
            'button',
            {
              'data-testid': 'emit-close',
              onClick: () => emit('close'),
            },
            'close',
          ),
        ])
    },
  }),
}))

describe('App 冲突恢复流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mergeConflictCb = null
    flowDialogSpies.openConfirm.mockClear()
    flowDialogSpies.confirmRun.mockClear()
    flowDialogSpies.closeAll.mockClear()
  })

  afterEach(() => {
    mergeConflictCb = null
  })

  it('冲突弹窗发出 resolved 事件时不应重新启动一轮批量合并', async () => {
    const { mount, flushPromises } = await import('@vue/test-utils')
    const App = (await import('../src/App.vue')).default

    const wrapper = mount(App, { attachTo: document.body })

    expect(flowDialogSpies.confirmRun).not.toHaveBeenCalled()

    mergeConflictCb?.({
      runId: 'run-1',
      projectId: 1,
      mrIid: 101,
      source: 'feat/test',
      target: 'dev',
      conflicts: [],
    })
    await nextTick()
    await nextTick()
    await flushPromises()

    expect(flowDialogSpies.closeAll).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="conflict-dialog"]').exists()).toBe(true)

    await wrapper.find('[data-testid="emit-resolved"]').trigger('click')
    await nextTick()

    expect(flowDialogSpies.confirmRun).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
