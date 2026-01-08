import type { GitLabMergeRequest } from "../../shared/gitlab/types";

export type MergePair = { source: string; target: string };

export type MergeNoop = {
  type: "noop";
  source: string;
  target: string;
  reason: string;
  mrIid?: number;
};

export type MergeConflict = {
  type: "conflict";
  source: string;
  target: string;
  reason: string;
  mrIid?: number;
  mrWebUrl?: string;
  conflicts?: any[];
};

export type MergeCreated = {
  type: "created";
  source: string;
  target: string;
  mr: GitLabMergeRequest;
};

export type MergeResult =
  | { ok: true; mergedIids: number[]; noop: MergeNoop[] }
  | {
      ok: false;
      rolledBack: boolean;
      conflicts: MergeConflict[];
      noop: MergeNoop[];
    };

export type ConflictResolution = {
  resolved: boolean;
  message?: string;
};

export type ConflictHandler = (data: {
  projectId: number;
  mrIid: number;
  source: string;
  target: string;
  conflicts: any[];
}) => Promise<ConflictResolution>;
