import type { MergePair, MergeResult } from "../../main/services/mergeTypes";
import type { GitLabProject } from "../../shared/gitlab/types";

export type AuthState = {
  baseUrl: string;
  token: string;
  rememberToken: boolean;
  connected: boolean;
  user?: { name?: string; username?: string };
  error?: string;
};

export type ListProjectsItem = {
  id: number;
  display: string;
  search: string;
  pinyinFull: string;
  pinyinInitials: string;
};

export type ListProjectsResponse = {
  items: ListProjectsItem[];
};

export type ListBranchesResponse = {
  branches: string[];
};

export type BatchMergeRequest = {
  projectId: number;
  pairs: MergePair[];
  runId?: string;
};

export type BatchMergeResponse = MergeResult;

export type BatchMergeLogEvent = {
  runId?: string;
  text: string;
  error?: boolean;
};

export type GitLabRawProject = GitLabProject;
