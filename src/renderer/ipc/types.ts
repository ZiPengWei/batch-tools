import type { MergePair, MergeResult } from "../../main/services/mergeTypes";

export type AuthState = {
  baseUrl: string;
  token: string;
  rememberToken: boolean;
  connected: boolean;
  user?: { name?: string; username?: string; nickname?: string };
  error?: string;
};

export type ListProjectsItem = {
  /** CNB 仓库完整路径，如 org/repo */
  id: string;
  display: string;
  search: string;
  pinyinFull: string;
  pinyinInitials: string;
  /** 是否被当前用户在 CNB 服务端置顶 */
  pinned?: boolean;
};

export type ListProjectsResponse = {
  items: ListProjectsItem[];
};

export type ListBranchesResponse = {
  branches: string[];
};

export type BatchMergeRequest = {
  /** CNB 仓库完整路径，如 org/repo */
  repo: string;
  pairs: MergePair[];
  runId?: string;
};

export type BatchMergeResponse = MergeResult;

export type BatchMergeLogEvent = {
  runId?: string;
  text: string;
  error?: boolean;
};
