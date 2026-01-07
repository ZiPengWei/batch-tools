import { describe, expect, it, vi } from 'vitest'

describe('onBatchMergeLog', () => {
  it('ipcRenderer 缺失时返回空的取消函数', async () => {
    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = {}
    const mod = await import('../src/renderer/ipc/bridge')

    const stop = mod.onBatchMergeLog(() => {})
    expect(typeof stop).toBe('function')
    stop()

    ;(globalThis as any).window = originalWindow
  })

  it('会注册/注销 gitlab:batch-merge-log 事件监听', async () => {
    const originalWindow = (globalThis as any).window
    const on = vi.fn()
    const off = vi.fn()
    ;(globalThis as any).window = { ipcRenderer: { on, off } }

    const mod = await import('../src/renderer/ipc/bridge')
    const cb = vi.fn()

    const stop = mod.onBatchMergeLog(cb)
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0]).toBe('gitlab:batch-merge-log')

    const handler = on.mock.calls[0][1]
    handler({}, { text: 't' })
    expect(cb).toHaveBeenCalledWith({ text: 't' })

    stop()
    expect(off).toHaveBeenCalledTimes(1)
    expect(off.mock.calls[0][0]).toBe('gitlab:batch-merge-log')
    expect(off.mock.calls[0][1]).toBe(handler)

    ;(globalThis as any).window = originalWindow
  })
})

