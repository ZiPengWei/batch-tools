import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BatchMergeConfirmDialog from '../src/renderer/components/BatchMergeConfirmDialog.vue'

describe('BatchMergeConfirmDialog', () => {
  const originalIpc = (globalThis as any).window?.ipcRenderer

  beforeEach(() => {
    (globalThis as any).window.ipcRenderer = {
      on: vi.fn(),
      off: vi.fn(),
      invoke: vi.fn(),
    }
  })

  afterEach(() => {
    (globalThis as any).window.ipcRenderer = originalIpc
  })

  it('点击确认会触发 run 并发出 run-finish', async () => {
    const run = vi.fn().mockResolvedValue({
      ok: true,
      merged: [{ source: 'feat', target: 'main' }],
      conflicts: [],
      noop: [],
      failures: [],
    })

    const wrapper = mount(BatchMergeConfirmDialog, {
      attachTo: document.body,
      props: {
        show: true,
        repo: 'org/repo',
        sourceBranches: ['feat'],
        targetCount: 2,
        logLines: [],
        run,
      },
    })

    await nextTick()

    const confirmBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === '确认',
    )
    expect(confirmBtn).toBeTruthy()
    ;(confirmBtn as HTMLButtonElement).click()

    for (let i = 0; i < 8; i++) {
      await nextTick()
      await Promise.resolve()
    }

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('org/repo', ['feat'])
    expect(wrapper.emitted('run-finish')).toBeTruthy()
    expect(wrapper.emitted('run-finish')![0]?.[0]).toEqual({
      ok: true,
      merged: [{ source: 'feat', target: 'main' }],
      conflicts: [],
      noop: [],
      failures: [],
    })

    wrapper.unmount()
  })

  it('repo 为空时点击确认不会触发 run', async () => {
    const run = vi.fn().mockResolvedValue(null)

    const wrapper = mount(BatchMergeConfirmDialog, {
      attachTo: document.body,
      props: {
        show: true,
        repo: '',
        sourceBranches: ['feat'],
        targetCount: 1,
        logLines: [],
        run,
      },
    })

    await nextTick()

    const confirmBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === '确认',
    )
    expect(confirmBtn).toBeTruthy()
    ;(confirmBtn as HTMLButtonElement).click()

    for (let i = 0; i < 4; i++) {
      await nextTick()
      await Promise.resolve()
    }

    expect(run).not.toHaveBeenCalled()
    expect(wrapper.emitted('run-finish')).toBeFalsy()

    wrapper.unmount()
  })
})
