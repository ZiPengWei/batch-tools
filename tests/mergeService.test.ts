import { describe, expect, it, vi } from 'vitest'

import { MergeService } from '../src/main/services/mergeService'

function createClientMock() {
  return {
    createMergeRequest: vi.fn(),
    deleteMergeRequest: vi.fn().mockResolvedValue(true),
    getMergeRequestConflicts: vi.fn().mockResolvedValue([]),
    acceptMergeRequest: vi.fn().mockResolvedValue({}),
    updateMergeRequest: vi.fn().mockResolvedValue({}),
  } as const
}

describe('MergeService.runAtomicBatchMerge', () => {
  it('source==target 时返回 noop 且不创建 MR', async () => {
    const client = createClientMock()
    const service = new MergeService(client as any)

    const res = await service.runAtomicBatchMerge(1, [{ source: 'a', target: 'a' }])

    expect(client.createMergeRequest).not.toHaveBeenCalled()
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.mergedIids).toEqual([])
    expect(res.noop).toEqual([{ type: 'noop', source: 'a', target: 'a', reason: 'source == target' }])
  })

  it('检测到无变更时删除 MR 并跳过后续合并', async () => {
    const client = createClientMock()
    client.createMergeRequest.mockResolvedValueOnce({ iid: 10 })

    const service = new MergeService(client as any)
    vi.spyOn(service, 'waitUntilMergeable').mockResolvedValueOnce({
      ok: false,
      reason: '__noop_no_changes__',
      details: { iid: 10 },
    } as any)

    const res = await service.runAtomicBatchMerge(1, [{ source: 'feat', target: 'main' }])

    expect(client.deleteMergeRequest).toHaveBeenCalledWith(1, 10)
    expect(client.acceptMergeRequest).not.toHaveBeenCalled()
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.mergedIids).toEqual([])
    expect(res.noop).toEqual([{ type: 'noop', source: 'feat', target: 'main', reason: '无变更', mrIid: 10 }])
  })

  it('阶段 2 出现冲突时触发回滚并删除已创建 MR', async () => {
    const client = createClientMock()
    client.createMergeRequest.mockResolvedValueOnce({ iid: 1 }).mockResolvedValueOnce({ iid: 2 })
    client.getMergeRequestConflicts.mockResolvedValueOnce([{ file: 'a.txt' }])

    const service = new MergeService(client as any)
    vi.spyOn(service, 'waitUntilMergeable')
      .mockResolvedValueOnce({ ok: true, details: { iid: 1 } } as any)
      .mockResolvedValueOnce({ ok: false, reason: '检测到冲突（不可合并）', details: { iid: 2, web_url: 'u' } } as any)

    const res = await service.runAtomicBatchMerge(1, [
      { source: 'a', target: 'main' },
      { source: 'b', target: 'main' },
    ])

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.rolledBack).toBe(true)
    expect(res.conflicts).toEqual([
      {
        type: 'conflict',
        source: 'b',
        target: 'main',
        reason: '检测到冲突（不可合并）',
        mrIid: 2,
        mrWebUrl: 'u',
        conflicts: [{ file: 'a.txt' }],
      },
    ])
    expect(client.deleteMergeRequest).toHaveBeenCalledWith(1, 1)
    expect(client.deleteMergeRequest).toHaveBeenCalledWith(1, 2)
  })

  it('阶段 3 合并未完成时不回滚但会关闭 MR 并返回失败', async () => {
    const client = createClientMock()
    client.createMergeRequest.mockResolvedValueOnce({ iid: 3 })

    const service = new MergeService(client as any)
    vi.spyOn(service, 'waitUntilMergeable').mockResolvedValueOnce({ ok: true, details: { iid: 3 } } as any)
    vi.spyOn(service, 'waitUntilMerged').mockResolvedValueOnce({ ok: false, reason: 'MR 已被关闭', details: { iid: 3 } } as any)

    const res = await service.runAtomicBatchMerge(1, [{ source: 'feat', target: 'main' }])

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.rolledBack).toBe(false)
    expect(client.updateMergeRequest).toHaveBeenCalledWith(1, 3, 'close')
    expect(res.conflicts[0]).toMatchObject({ mrIid: 3 })
  })
})

