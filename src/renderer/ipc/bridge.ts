import type { ListBranchesResponse, ListProjectsResponse } from './types'
import type { BatchMergeRequest, BatchMergeResponse } from './types'

type IpcInvoke = (channel: string, ...args: any[]) => Promise<any>

function invoke(): IpcInvoke {
  return (window.ipcRenderer?.invoke?.bind(window.ipcRenderer) as any) ?? (async () => {
    throw new Error('ipcRenderer 不可用（请确认已在 Electron 环境运行）')
  })
}

export async function setAuth(payload: { baseUrl: string; token: string }) {
  return invoke()('gitlab:set-auth', payload) as Promise<any>
}

export async function listProjects(): Promise<ListProjectsResponse> {
  return invoke()('gitlab:list-projects') as Promise<ListProjectsResponse>
}

export async function listBranches(payload: { projectId: number }): Promise<ListBranchesResponse> {
  return invoke()('gitlab:list-branches', payload) as Promise<ListBranchesResponse>
}

export async function batchMerge(payload: BatchMergeRequest): Promise<BatchMergeResponse> {
  return invoke()('gitlab:batch-merge', payload) as Promise<BatchMergeResponse>
}

