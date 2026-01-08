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
    const removeAllListeners = vi.fn()
    ;(globalThis as any).window = { ipcRenderer: { on, off, removeAllListeners } }

    const mod = await import('../src/renderer/ipc/bridge')
    const cb = vi.fn()

    const stop = mod.onBatchMergeLog(cb)
    expect(removeAllListeners).toHaveBeenCalledTimes(1)
    expect(removeAllListeners.mock.calls[0][0]).toBe('gitlab:batch-merge-log')
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

  it('重复调用时会清理旧监听，避免监听器累积', async () => {
    const originalWindow = (globalThis as any).window
    const on = vi.fn()
    const off = vi.fn()
    const removeAllListeners = vi.fn()
    ;(globalThis as any).window = { ipcRenderer: { on, off, removeAllListeners } }

    const mod = await import('../src/renderer/ipc/bridge')

    const cb1 = vi.fn()
    const stop1 = mod.onBatchMergeLog(cb1)
    const handler1 = on.mock.calls[0][1]

    const cb2 = vi.fn()
    const stop2 = mod.onBatchMergeLog(cb2)
    const handler2 = on.mock.calls[1][1]

    expect(removeAllListeners).toHaveBeenCalledTimes(2)
    expect(on).toHaveBeenCalledTimes(2)
    expect(handler1).not.toBe(handler2)

    handler1({}, { text: 'old' })
    handler2({}, { text: 'new' })
    expect(cb1).toHaveBeenCalledWith({ text: 'old' })
    expect(cb2).toHaveBeenCalledWith({ text: 'new' })

    stop1()
    stop2()
    expect(off).toHaveBeenCalledTimes(2)

    ;(globalThis as any).window = originalWindow
  })
})
