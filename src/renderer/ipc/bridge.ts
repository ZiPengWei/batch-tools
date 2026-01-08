import type { ListBranchesResponse, ListProjectsResponse } from "./types";
import type {
  BatchMergeLogEvent,
  BatchMergeRequest,
  BatchMergeResponse,
} from "./types";

type IpcInvoke = (channel: string, ...args: any[]) => Promise<any>;

function invoke(): IpcInvoke {
  return (
    (window.ipcRenderer?.invoke?.bind(window.ipcRenderer) as any) ??
    (async () => {
      throw new Error("ipcRenderer 不可用（请确认已在 Electron 环境运行）");
    })
  );
}

export async function setAuth(payload: { baseUrl: string; token: string }) {
  return invoke()("gitlab:set-auth", payload) as Promise<any>;
}

export async function listProjects(): Promise<ListProjectsResponse> {
  return invoke()("gitlab:list-projects") as Promise<ListProjectsResponse>;
}

export async function listBranches(payload: {
  projectId: number;
}): Promise<ListBranchesResponse> {
  return invoke()(
    "gitlab:list-branches",
    payload
  ) as Promise<ListBranchesResponse>;
}

export async function batchMerge(
  payload: BatchMergeRequest
): Promise<BatchMergeResponse> {
  return invoke()("gitlab:batch-merge", payload) as Promise<BatchMergeResponse>;
}

export function onBatchMergeLog(callback: (e: BatchMergeLogEvent) => void) {
  const ipc = window.ipcRenderer;
  if (!ipc?.on || !ipc?.off) return () => {};
  const handler = (_event: any, payload: BatchMergeLogEvent) => {
    callback(payload);
  };
  ipc.on("gitlab:batch-merge-log", handler);
  return () => {
    ipc.off("gitlab:batch-merge-log", handler);
  };
}

export function onMergeConflict(callback: (payload: any) => void) {
  const ipc = window.ipcRenderer;
  if (!ipc?.on || !ipc?.off) return () => {};
  const handler = (_event: any, payload: any) => {
    callback(payload);
  };
  ipc.on("gitlab:merge-conflict", handler);
  return () => {
    ipc.off("gitlab:merge-conflict", handler);
  };
}

export async function resolveConflict(payload: { runId: string; resolution: any }) {
  return invoke()("gitlab:resolve-conflict", payload);
}

export async function getFileContent(payload: { projectId: number; filePath: string; ref: string }) {
  return invoke()("gitlab:get-file-content", payload);
}

export async function createCommit(payload: { projectId: number; branch: string; message: string; actions: any[] }) {
  return invoke()("gitlab:create-commit", payload);
}
