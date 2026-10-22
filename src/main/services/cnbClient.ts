import axios, { AxiosError, AxiosInstance } from "axios";
import type {
  CnbApiError,
  CnbBranch,
  CnbPull,
  CnbRepo,
  CnbUser,
  CreatePullResult,
} from "../../shared/cnb/types";

type RetryConfig = {
  total: number;
  backoffMs: number;
  statusForcelist: number[];
};

const defaultRetry: RetryConfig = {
  total: 3,
  backoffMs: 600,
  statusForcelist: [429, 500, 502, 503, 504],
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(baseUrl: string) {
  return (baseUrl || "").replace(/\/+$/, "");
}

/** 仓库路径 org/repo -> URL 路径（逐段编码，兼容多级组织 a/b/c） */
function encodeRepoPath(repo: string) {
  return String(repo || "")
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

function isRetriableStatus(status: number | undefined, retry: RetryConfig) {
  return status != null && retry.statusForcelist.includes(status);
}

function extractErrorMessage(err: unknown): CnbApiError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    const data = err.response?.data;
    const message = (() => {
      const d = data as any;
      if (d && typeof d === "object") {
        const msg = d.errmsg ?? d.message;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
        const e = d.error;
        if (typeof e === "string" && e.trim()) return e.trim();
      }
      if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
      const text = (err.response?.statusText || "").trim();
      return text || `HTTP ${status || "Error"}`;
    })();
    return { status, message, data };
  }
  return { status: 0, message: String(err ?? "Unknown error") };
}

function isNoChangeError(message: string | undefined) {
  const s = (message || "").toLowerCase();
  const keys = [
    "no commits",
    "no changes",
    "nothing to merge",
    "nothing to commit",
    "already up to date",
    "already up-to-date",
    "无变更",
    "没有变更",
    "没有差异",
    "无需合并",
    "没有可合并",
    "无差异",
  ];
  return keys.some((k) => s.includes(k));
}

async function requestWithRetry<T>(
  fn: () => Promise<T>,
  retry: RetryConfig = defaultRetry
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retry.total; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const axiosErr = e as AxiosError;
      const status = axios.isAxiosError(axiosErr)
        ? axiosErr.response?.status
        : undefined;
      const retriable = isRetriableStatus(status, retry);
      if (!retriable || i === retry.total) break;
      const backoff = retry.backoffMs * Math.max(1, i + 1);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/**
 * CNB (cnb.cool) Open API 客户端
 * 文档：https://api.cnb.cool/
 *
 * 认证方式：Authorization: Bearer <访问令牌>
 * 仓库标识：完整仓库路径字符串（如 "org/repo"），而非数字 ID
 */
export class CnbClient {
  private baseUrl: string;
  private http: AxiosInstance;

  constructor(baseUrl = "https://api.cnb.cool", token: string | null = null) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 20_000,
    });
    if (token) this.setToken(token);
  }

  setBaseUrl(url: string) {
    this.baseUrl = normalizeBaseUrl(url);
    this.http.defaults.baseURL = this.baseUrl;
  }

  setToken(token: string) {
    const anyHttp = this.http as any;
    if (!anyHttp.defaults) anyHttp.defaults = {};
    if (!anyHttp.defaults.headers) anyHttp.defaults.headers = {};
    if (!anyHttp.defaults.headers.common) anyHttp.defaults.headers.common = {};
    anyHttp.defaults.headers.common.Authorization = `Bearer ${token}`;
  }

  clearToken() {
    const anyHttp = this.http as any;
    if (!anyHttp.defaults?.headers?.common) return;
    delete anyHttp.defaults.headers.common.Authorization;
  }

  /** 获取当前用户信息（用于验证令牌有效性），需 account-profile:r 权限 */
  async verifyToken(): Promise<
    { ok: true; user: CnbUser } | { ok: false; error: CnbApiError }
  > {
    try {
      const res = await requestWithRetry(() =>
        this.http.get<CnbUser>("/user")
      );
      return { ok: true, user: res.data };
    } catch (e) {
      return { ok: false, error: extractErrorMessage(e) };
    }
  }

  /**
   * 获取当前用户拥有指定权限及以上的仓库列表（含个人与组织仓库）
   * 需 account-engage:r 权限。分页遍历全部页。
   */
  async getAllRepos(minRole = "Developer"): Promise<CnbRepo[]> {
    const repos: CnbRepo[] = [];
    let page = 1;
    const pageSize = 100;

    for (;;) {
      const params = {
        role: minRole,
        page,
        page_size: pageSize,
        order_by: "last_updated_at",
        desc: true,
      };
      try {
        const res = await requestWithRetry(() =>
          this.http.get<CnbRepo[]>("/user/repos", { params })
        );
        const data = res.data || [];
        if (!data.length) break;
        repos.push(...data);
        if (data.length < pageSize) break;
        page += 1;
        if (page > 100) break;
      } catch (e) {
        if (repos.length) break;
        throw e;
      }
    }

    const uniqueByPath = new Map<string, CnbRepo>();
    for (const r of repos) {
      const path = r?.path || String(r?.id || "");
      if (!path) continue;
      if (!uniqueByPath.has(path)) uniqueByPath.set(path, r);
    }
    return Array.from(uniqueByPath.values());
  }

  /** 分页获取仓库全部分支名列表 */
  async getBranches(repo: string): Promise<CnbBranch[]> {
    const branches: CnbBranch[] = [];
    let page = 1;
    const pageSize = 100;
    const repoPath = encodeRepoPath(repo);

    for (;;) {
      const params = { page, page_size: pageSize };
      try {
        const res = await requestWithRetry(() =>
          this.http.get<CnbBranch[]>(`/${repoPath}/-/git/branches`, { params })
        );
        const data = res.data || [];
        if (!data.length) break;
        branches.push(...data);
        if (data.length < pageSize) break;
        page += 1;
        if (page > 100) break;
      } catch (e) {
        if (branches.length) break;
        throw e;
      }
    }

    const uniqueByName = new Map<string, CnbBranch>();
    for (const b of branches) {
      const name = b?.name;
      if (!name) continue;
      if (!uniqueByName.has(name)) uniqueByName.set(name, b);
    }
    return Array.from(uniqueByName.values());
  }

  /**
   * 比较两个分支的差异，用于预检“无变更”（noop）。
   * 返回 { totalCommits }；接口失败时返回 null（不阻塞主流程）。
   */
  async compareBranches(
    repo: string,
    base: string,
    head: string
  ): Promise<{ totalCommits: number } | null> {
    const repoPath = encodeRepoPath(repo);
    const baseHead = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    try {
      const res = await requestWithRetry(() =>
        this.http.get<any>(`/${repoPath}/-/git/compare/${baseHead}`)
      );
      const data = res.data as any;
      const total = Number(data?.total_commits ?? data?.commits?.length ?? 0);
      return { totalCommits: Number.isFinite(total) ? total : 0 };
    } catch {
      return null;
    }
  }

  /** 创建合并请求（PR）。需 repo-pr:rw 权限 */
  async createPull(
    repo: string,
    sourceBranch: string,
    targetBranch: string,
    title: string
  ): Promise<CreatePullResult> {
    const repoPath = encodeRepoPath(repo);
    const data = {
      head: sourceBranch,
      base: targetBranch,
      title,
    };
    try {
      const res = await requestWithRetry(() =>
        this.http.post<CnbPull>(`/${repoPath}/-/pulls`, data)
      );
      return res.data;
    } catch (e) {
      const apiErr = extractErrorMessage(e);
      if (isNoChangeError(apiErr.message))
        return { status: "noop", message: apiErr.message };
      return { status: "error", message: apiErr.message };
    }
  }

  /**
   * 查找源/目标分支相同的 open 状态 PR（用于复用已存在的 PR）
   * CNB 支持按 base_ref 过滤，源分支在客户端按 head.ref 过滤
   */
  async findOpenPull(
    repo: string,
    sourceBranch: string,
    targetBranch: string
  ): Promise<CnbPull | null> {
    const repoPath = encodeRepoPath(repo);
    try {
      const params = {
        state: "open",
        base_ref: targetBranch,
        page: 1,
        page_size: 100,
      };
      const res = await requestWithRetry(() =>
        this.http.get<CnbPull[]>(`/${repoPath}/-/pulls`, { params })
      );
      const list = res.data || [];
      return (
        list.find((p) => {
          const headRef = String(p?.head?.ref || "").replace(/^refs\/heads\//, "");
          return headRef === sourceBranch;
        }) || null
      );
    } catch {
      return null;
    }
  }

  /** 获取 PR 详情（含 mergeable_state / state / blocked_on） */
  async getPull(repo: string, pullNumber: string | number): Promise<CnbPull> {
    const repoPath = encodeRepoPath(repo);
    const res = await requestWithRetry(() =>
      this.http.get<CnbPull>(`/${repoPath}/-/pulls/${encodeURIComponent(
        String(pullNumber)
      )}`)
    );
    return res.data;
  }

  /** 合并 PR。需 repo-pr:rw 权限。返回 { merged, message, sha } */
  async mergePull(
    repo: string,
    pullNumber: string | number,
    opts?: { mergeStyle?: "merge" | "squash" | "rebase" | "fast_forward" }
  ): Promise<{ merged: boolean; message: string; sha?: string }> {
    const repoPath = encodeRepoPath(repo);
    const data = {
      merge_style: opts?.mergeStyle ?? "merge",
    };
    const res = await requestWithRetry(() =>
      this.http.put<{ merged?: boolean; message?: string; sha?: string }>(
        `/${repoPath}/-/pulls/${encodeURIComponent(String(pullNumber))}/merge`,
        data,
        { timeout: 30_000 }
      )
    );
    return {
      merged: Boolean(res.data?.merged),
      message: res.data?.message || "",
      sha: res.data?.sha,
    };
  }

  /** 关闭（取消）PR：PATCH state=closed */
  async closePull(repo: string, pullNumber: string | number): Promise<boolean> {
    const repoPath = encodeRepoPath(repo);
    try {
      await requestWithRetry(() =>
        this.http.patch(
          `/${repoPath}/-/pulls/${encodeURIComponent(String(pullNumber))}`,
          { state: "closed" }
        )
      );
      return true;
    } catch {
      return false;
    }
  }
}
