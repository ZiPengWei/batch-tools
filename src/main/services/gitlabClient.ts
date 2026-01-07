import axios, { AxiosError, AxiosInstance } from "axios";
import type {
  CreateMergeRequestResult,
  GitLabApiError,
  GitLabBranch,
  GitLabMergeRequest,
  GitLabMergeRequestChanges,
  GitLabProject,
  GitLabUser,
} from "../../shared/gitlab/types";

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

function isRetriableStatus(status: number | undefined, retry: RetryConfig) {
  return status != null && retry.statusForcelist.includes(status);
}

function extractErrorMessage(err: unknown): GitLabApiError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 0;
    const data = err.response?.data;
    const message = (() => {
      const d = data as any;
      if (d && typeof d === "object") {
        const msg = d.message;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
        if (Array.isArray(msg) && msg.length) return msg.map(String).join("; ");
        if (msg && typeof msg === "object") {
          const parts: string[] = [];
          for (const [k, v] of Object.entries(msg)) {
            if (Array.isArray(v))
              parts.push(`${k}: ${v.map(String).join("; ")}`);
            else parts.push(`${k}: ${String(v)}`);
          }
          if (parts.length) return parts.join("; ");
        }
        const e = d.error;
        if (typeof e === "string" && e.trim()) return e.trim();
      }
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
    "already up to date",
    "already up-to-date",
    "is already up to date",
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

export class GitLabClient {
  private baseUrl: string;
  private http: AxiosInstance;

  constructor(
    baseUrl = "http://172.16.43.4:30085",
    token: string | null = null
  ) {
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
    this.http.defaults.headers.common["PRIVATE-TOKEN"] = token;
  }

  clearToken() {
    delete this.http.defaults.headers.common["PRIVATE-TOKEN"];
  }

  async verifyToken(): Promise<
    { ok: true; user: GitLabUser } | { ok: false; error: GitLabApiError }
  > {
    try {
      const res = await requestWithRetry(() =>
        this.http.get<GitLabUser>("/api/v4/user")
      );
      return { ok: true, user: res.data };
    } catch (e) {
      return { ok: false, error: extractErrorMessage(e) };
    }
  }

  async searchProjects(
    query: string,
    minAccessLevel = 30
  ): Promise<GitLabProject[]> {
    const params = {
      search: query,
      min_access_level: minAccessLevel,
      simple: true,
      order_by: "last_activity_at",
      per_page: 100,
    };
    const res = await requestWithRetry(() =>
      this.http.get<GitLabProject[]>("/api/v4/projects", { params })
    );
    return res.data;
  }

  async getAllProjects(minAccessLevel = 30): Promise<GitLabProject[]> {
    const projects: GitLabProject[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const params = {
        min_access_level: minAccessLevel,
        simple: true,
        order_by: "last_activity_at",
        per_page: perPage,
        page,
      };
      try {
        const res = await requestWithRetry(() =>
          this.http.get<GitLabProject[]>("/api/v4/projects", { params })
        );
        const data = res.data;
        if (!data || data.length === 0) break;
        projects.push(...data);
        page += 1;
        if (page > 20) break;
      } catch (e) {
        if (projects.length) break;
        throw e;
      }
    }
    return projects;
  }

  async getBranches(
    projectId: number,
    search?: string
  ): Promise<GitLabBranch[]> {
    const branches: GitLabBranch[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const params: Record<string, unknown> = { per_page: perPage, page };
      if (search) params.search = search;

      try {
        const res = await requestWithRetry(() =>
          this.http.get<GitLabBranch[]>(
            `/api/v4/projects/${projectId}/repository/branches`,
            { params }
          )
        );
        const data = res.data || [];
        if (!data.length) break;
        branches.push(...data);

        const next = String((res.headers as any)?.["x-next-page"] ?? "").trim();
        if (next) {
          const nextNum = Number(next);
          if (Number.isFinite(nextNum) && nextNum > page) page = nextNum;
          else page += 1;
        } else {
          if (data.length < perPage) break;
          page += 1;
        }

        if (page > 100) break;
      } catch (e) {
        if (branches.length) break;
        throw e;
      }
    }

    const uniqueByName = new Map<string, GitLabBranch>();
    for (const b of branches) {
      const name = b?.name;
      if (!name) continue;
      if (!uniqueByName.has(name)) uniqueByName.set(name, b);
    }
    return Array.from(uniqueByName.values());
  }

  async getMergeRequest(
    projectId: number,
    mrIid: number
  ): Promise<GitLabMergeRequest> {
    const res = await requestWithRetry(() =>
      this.http.get<GitLabMergeRequest>(
        `/api/v4/projects/${projectId}/merge_requests/${mrIid}`
      )
    );
    return res.data;
  }

  async getMergeRequestConflicts(
    projectId: number,
    mrIid: number
  ): Promise<any[]> {
    try {
      const res = await requestWithRetry(() =>
        this.http.get<any>(
          `/api/v4/projects/${projectId}/merge_requests/${mrIid}/conflicts`
        )
      );
      if (res.status === 200 || res.status === 409)
        return (res.data as any) || [];
      return [];
    } catch {
      return [];
    }
  }

  async getMergeRequestChanges(
    projectId: number,
    mrIid: number
  ): Promise<GitLabMergeRequestChanges | null> {
    try {
      const res = await requestWithRetry(() =>
        this.http.get<GitLabMergeRequestChanges>(
          `/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`
        )
      );
      return res.data;
    } catch {
      return null;
    }
  }

  async createMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string,
    title: string
  ): Promise<CreateMergeRequestResult> {
    const data = {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
    };
    try {
      const res = await requestWithRetry(() =>
        this.http.post<GitLabMergeRequest>(
          `/api/v4/projects/${projectId}/merge_requests`,
          data
        )
      );
      return res.data;
    } catch (e) {
      const apiErr = extractErrorMessage(e);
      if (apiErr.status >= 400) {
        if (isNoChangeError(apiErr.message))
          return { status: "noop", message: apiErr.message };
        if (apiErr.status === 409)
          return {
            status: "error",
            message: apiErr.message || "Conflict or MR already exists",
          };
        return { status: "error", message: apiErr.message };
      }
      return { status: "error", message: apiErr.message };
    }
  }

  async updateMergeRequest(
    projectId: number,
    mrIid: number,
    stateEvent?: string
  ): Promise<GitLabMergeRequest> {
    const data: Record<string, unknown> = {};
    if (stateEvent) data.state_event = stateEvent;
    const res = await requestWithRetry(() =>
      this.http.put<GitLabMergeRequest>(
        `/api/v4/projects/${projectId}/merge_requests/${mrIid}`,
        data
      )
    );
    return res.data;
  }

  async deleteMergeRequest(projectId: number, mrIid: number): Promise<boolean> {
    try {
      await requestWithRetry(() =>
        this.http.delete(
          `/api/v4/projects/${projectId}/merge_requests/${mrIid}`
        )
      );
      return true;
    } catch {
      try {
        await this.updateMergeRequest(projectId, mrIid, "close");
        return true;
      } catch {
        return false;
      }
    }
  }

  async acceptMergeRequest(
    projectId: number,
    mrIid: number,
    opts?: {
      mergeWhenPipelineSucceeds?: boolean;
      shouldRemoveSourceBranch?: boolean;
      squash?: boolean;
    }
  ): Promise<GitLabMergeRequest> {
    const data: Record<string, unknown> = {};
    if (opts?.mergeWhenPipelineSucceeds != null)
      data.merge_when_pipeline_succeeds = Boolean(
        opts.mergeWhenPipelineSucceeds
      );
    if (opts?.shouldRemoveSourceBranch != null)
      data.should_remove_source_branch = Boolean(opts.shouldRemoveSourceBranch);
    if (opts?.squash != null) data.squash = Boolean(opts.squash);

    const res = await requestWithRetry(() =>
      this.http.put<GitLabMergeRequest>(
        `/api/v4/projects/${projectId}/merge_requests/${mrIid}/merge`,
        Object.keys(data).length ? data : undefined,
        { timeout: 30_000 }
      )
    );
    return res.data;
  }
}
