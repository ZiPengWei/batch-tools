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
  (ipc as any).removeAllListeners?.("gitlab:batch-merge-log");
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

export async function resolveConflict(payload: {
  runId: string;
  resolution: any;
}) {
  return invoke()("gitlab:resolve-conflict", payload);
}

export async function getFileContent(payload: {
  projectId: number;
  filePath: string;
  ref: string;
}) {
  return invoke()("gitlab:get-file-content", payload);
}

export async function getFileMetadata(payload: {
  projectId: number;
  filePath: string;
  ref: string;
}) {
  return invoke()("gitlab:get-file-metadata", payload);
}

export async function getMergeRequestChanges(payload: {
  projectId: number;
  mrIid: number;
}) {
  return invoke()("gitlab:get-merge-request-changes", payload);
}

export async function getMergeRequestConflicts(payload: {
  projectId: number;
  mrIid: number;
}) {
  return invoke()("gitlab:get-merge-request-conflicts", payload);
}

export async function getMergeRequestConflictsFull(payload: {
  projectId: number;
  mrIid: number;
  mrWebUrl: string;
}) {
  return invoke()("gitlab:get-merge-request-conflicts-full", payload);
}

export async function getMergeRequestConflictForPath(payload: {
  mrWebUrl: string;
  mrIid: number;
  oldPath: string;
  newPath: string;
}) {
  return invoke()("gitlab:get-conflict-for-path", payload);
}

export async function resolveMergeRequestConflicts(payload: {
  mrWebUrl: string;
  mrIid: number;
  commit_message: string;
  files: any[];
}) {
  return invoke()("gitlab:resolve-conflicts", payload);
}

export async function getMergeRequest(payload: {
  projectId: number;
  mrIid: number;
}) {
  return invoke()("gitlab:get-merge-request", payload);
}

export async function createCommit(payload: {
  projectId: number;
  branch: string;
  message: string;
  actions: any[];
}) {
  return invoke()("gitlab:create-commit", payload);
}

export async function getMergeBase(payload: {
  projectId: number;
  refs: string[];
}) {
  return invoke()("gitlab:get-merge-base", payload);
}

export async function localGitPrepareConflicts(payload: {
  runId: string;
  projectId: number;
  source: string;
  target: string;
  mrWebUrl?: string;
}) {
  return invoke()("localgit:prepare-conflicts", payload);
}

export async function localGitGetFileContents(payload: {
  runId: string;
  filePath: string;
  targetPath?: string;
  sourcePath?: string;
  basePath?: string;
}) {
  return invoke()("localgit:get-file-contents", payload);
}

export async function localGitMergeFileContents(payload: {
  base: string;
  left: string;
  right: string;
  labels?: { left?: string; base?: string; right?: string };
  diff3?: boolean;
}) {
  return invoke()("localgit:merge-file-contents", payload);
}

export async function localGitCleanup(payload: { runId: string }) {
  return invoke()("localgit:cleanup", payload);
}

export async function openExternal(url: string) {
  return invoke()("shell:open-external", url);
}
