import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

let batchMergeLogCallback: ((e: any) => void) | null = null
const stopListenSpy = vi.fn()

vi.mock('../src/renderer/ipc/bridge', () => {
  return {
    onBatchMergeLog: (cb: (e: any) => void) => {
      batchMergeLogCallback = cb
      return () => {
        stopListenSpy()
        batchMergeLogCallback = null
      }
    },
    batchMerge: async (payload: any) => {
      const runId = payload?.runId
      batchMergeLogCallback?.({ runId: 'other', text: 'should-not-show' })
      batchMergeLogCallback?.({ runId, text: 'step-1' })
      batchMergeLogCallback?.({ runId, text: 'step-2', error: true })
      return { ok: true, mergedIids: [], noop: [] }
    },
  }
})

import { useMergeStore } from '../src/renderer/store/merge'

describe('merge store log wiring', () => {
  it('run() 会把批量合并日志写入 logLines，并按 runId 过滤', async () => {
    setActivePinia(createPinia())
    const store = useMergeStore()
    store.selectedTargets = ['main']

    const res = await store.run(1, ['feat'])
    expect(res?.ok).toBe(true)

    const texts = store.logLines.map((l) => l.text)
    expect(texts).toContain('=== 开始批量合并 ===')
    expect(texts).toContain('step-1')
    expect(texts).toContain('step-2')
    expect(texts).not.toContain('should-not-show')

    const step2 = store.logLines.find((l) => l.text === 'step-2')
    expect(step2?.error).toBe(true)

    expect(stopListenSpy).toHaveBeenCalledTimes(1)
  })
})

