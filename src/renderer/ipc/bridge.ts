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
  return invoke()("cnb:set-auth", payload) as Promise<any>;
}

export async function listProjects(): Promise<ListProjectsResponse> {
  return invoke()("cnb:list-projects") as Promise<ListProjectsResponse>;
}

export async function listBranches(payload: {
  repo: string;
}): Promise<ListBranchesResponse> {
  return invoke()("cnb:list-branches", payload) as Promise<ListBranchesResponse>;
}

export async function batchMerge(
  payload: BatchMergeRequest
): Promise<BatchMergeResponse> {
  return invoke()("cnb:batch-merge", payload) as Promise<BatchMergeResponse>;
}

export function onBatchMergeLog(callback: (e: BatchMergeLogEvent) => void) {
  const ipc = window.ipcRenderer;
  if (!ipc?.on || !ipc?.off) return () => {};
  (ipc as any).removeAllListeners?.("cnb:batch-merge-log");
  const handler = (_event: any, payload: BatchMergeLogEvent) => {
    callback(payload);
  };
  ipc.on("cnb:batch-merge-log", handler);
  return () => {
    ipc.off("cnb:batch-merge-log", handler);
  };
}

export async function openExternal(url: string) {
  return invoke()("shell:open-external", url);
}
