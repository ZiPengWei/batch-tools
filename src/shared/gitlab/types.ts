export type GitLabUser = {
  id?: number
  name?: string
  username?: string
  [key: string]: unknown
}

export type GitLabProject = {
  id?: number
  name?: string
  name_with_namespace?: string
  [key: string]: unknown
}

export type GitLabBranch = {
  name?: string
  [key: string]: unknown
}

export type GitLabMergeRequest = {
  iid?: number
  web_url?: string
  merge_status?: string
  detailed_merge_status?: string
  has_conflicts?: boolean
  state?: 'opened' | 'closed' | 'merged' | string
  changes_count?: string | number
  [key: string]: unknown
}

export type GitLabMergeRequestChanges = {
  changes?: Array<{
    old_path?: string
    new_path?: string
    diff?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

export type GitLabApiError = {
  status: number
  message: string
  data?: unknown
}

export type CreateMergeRequestResult =
  | { status: 'noop'; message: string }
  | { status: 'error'; message: string }
  | GitLabMergeRequest

