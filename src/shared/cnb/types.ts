export type CnbUser = {
  id?: string
  username?: string
  nickname?: string
  name?: string
  [key: string]: unknown
}

export type CnbRepo = {
  id?: string
  name?: string
  /** 完整仓库路径，格式：组织名称/仓库名称 */
  path?: string
  web_url?: string
  description?: string
  [key: string]: unknown
}

export type CnbBranch = {
  name?: string
  protected?: boolean
  locked?: boolean
  commit?: { sha?: string }
  [key: string]: unknown
}

/**
 * CNB 合并请求（Pull Request）
 * - mergeable_state: checking | mergeable | merging | merged | conflict | no-merge-base
 * - state: open | closed | merged
 * - blocked_on: no_merge_base | internal_error | code_conflict | status_check | waiting_review
 */
export type CnbPull = {
  number?: string | number
  title?: string
  state?: 'open' | 'closed' | 'merged' | string
  mergeable_state?:
    | 'checking'
    | 'mergeable'
    | 'merging'
    | 'merged'
    | 'conflict'
    | 'no-merge-base'
    | string
  blocked_on?: string
  is_merged?: boolean
  head?: { ref?: string; sha?: string }
  base?: { ref?: string; sha?: string }
  author?: { username?: string; nickname?: string }
  [key: string]: unknown
}

export type CnbApiError = {
  status: number
  message: string
  data?: unknown
}

export type CreatePullResult =
  | { status: 'noop'; message: string }
  | { status: 'error'; message: string }
  | CnbPull
