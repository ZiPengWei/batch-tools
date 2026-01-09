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

function parseProjectPathFromMrWebUrl(mrWebUrl: string): string | null {
  try {
    const u = new URL(mrWebUrl);
    const p = u.pathname || "";
    const marker = "/-/merge_requests/";
    const idx = p.indexOf(marker);
    if (idx <= 0) return null;
    const projectPath = p.slice(0, idx).replace(/^\/+/, "").replace(/\/+$/, "");
    if (!projectPath) return null;
    return projectPath;
  } catch {
    return null;
  }
}

function sanitizeHeaders(headers: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [k, v] of Object.entries(headers)) {
    const key = String(k).toLowerCase();
    if (key === "private-token" || key === "authorization" || key === "cookie")
      out[k] = "[REDACTED]";
    else out[k] = v as any;
  }
  return out;
}

function normalizeConflictFiles(list: unknown): any[] {
  const raw = Array.isArray(list) ? list : [];
  const out: any[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const anyIt = it as any;
    const p = String(
      anyIt.new_path ??
        anyIt.newPath ??
        anyIt.file_path ??
        anyIt.filePath ??
        anyIt.path ??
        anyIt.file ??
        ""
    ).trim();
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ ...anyIt, new_path: p });
  }
  return out;
}

function validateConflictsJsonStructure(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const anyData = data as any;
  return Array.isArray(anyData.files);
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
    const anyHttp = this.http as any;
    if (!anyHttp.defaults) anyHttp.defaults = {};
    if (!anyHttp.defaults.headers) anyHttp.defaults.headers = {};
    if (!anyHttp.defaults.headers.common) anyHttp.defaults.headers.common = {};
    anyHttp.defaults.headers.common["PRIVATE-TOKEN"] = token;
  }

  clearToken() {
    const anyHttp = this.http as any;
    if (!anyHttp.defaults?.headers?.common) return;
    delete anyHttp.defaults.headers.common["PRIVATE-TOKEN"];
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

  async getProject(projectId: number): Promise<GitLabProject> {
    const res = await requestWithRetry(() =>
      this.http.get<GitLabProject>(`/api/v4/projects/${projectId}`)
    );
    return res.data;
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
    mrIid: number,
    diagnostic?: (info: {
      ok: boolean;
      method: string;
      url: string;
      status?: number;
      requestHeaders?: Record<string, unknown>;
      responseHeaders?: Record<string, unknown>;
      error?: GitLabApiError;
      bodyKeys?: string[];
      bodyType?: string;
      filesCount?: number;
    }) => void
  ): Promise<any[]> {
    try {
      const apiPath = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/conflicts`;
      const res = await requestWithRetry(() =>
        this.http.get<any>(apiPath, {
          validateStatus: (status) =>
            (status >= 200 && status < 300) || status === 409,
        })
      );
      const data = res.data as any;
      diagnostic?.({
        ok: true,
        method: "GET",
        url: `${this.baseUrl}${apiPath}`,
        status: res.status,
        requestHeaders: sanitizeHeaders((res.config as any)?.headers),
        responseHeaders: sanitizeHeaders(res.headers),
        bodyKeys: data && typeof data === "object" ? Object.keys(data) : [],
        bodyType: Array.isArray(data) ? "array" : typeof data,
        filesCount: Array.isArray(data?.files)
          ? data.files.length
          : data?.files && typeof data.files === "object"
          ? Object.keys(data.files).length
          : Array.isArray(data)
          ? data.length
          : Array.isArray(data?.conflicts)
          ? data.conflicts.length
          : undefined,
      });
      if (Array.isArray(data?.files)) return data.files;
      if (data?.files && typeof data.files === "object") {
        const vals = Object.values(data.files as Record<string, unknown>);
        if (vals.every((v) => v && typeof v === "object")) return vals as any[];
      }
      if (Array.isArray(data?.conflicts)) return data.conflicts;
      if (Array.isArray(data)) return data;
      return [];
    } catch (e) {
      const err = extractErrorMessage(e);
      const axiosErr = e as AxiosError;
      const status = axios.isAxiosError(axiosErr)
        ? axiosErr.response?.status
        : undefined;
      const apiPath = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/conflicts`;
      diagnostic?.({
        ok: false,
        method: "GET",
        url: `${this.baseUrl}${apiPath}`,
        status,
        requestHeaders: sanitizeHeaders((axiosErr as any)?.config?.headers),
        responseHeaders: sanitizeHeaders((axiosErr as any)?.response?.headers),
        error: err,
        bodyKeys:
          err?.data && typeof err.data === "object"
            ? Object.keys(err.data as any)
            : [],
        bodyType: Array.isArray(err?.data) ? "array" : typeof err?.data,
      });
      if (status === 401 || status === 403) {
        throw new Error(
          `GitLab 认证/权限异常：HTTP ${status}（无法获取冲突列表）`
        );
      }
      return [];
    }
  }

  async getMergeRequestConflictsJsonByMrWebUrl(
    mrWebUrl: string,
    mrIid: number,
    diagnostic?: (info: {
      ok: boolean;
      method: string;
      url: string;
      status?: number;
      requestHeaders?: Record<string, unknown>;
      responseHeaders?: Record<string, unknown>;
      error?: GitLabApiError;
      bodyKeys?: string[];
      bodyType?: string;
      filesCount?: number;
      structureValid?: boolean;
    }) => void
  ): Promise<any[]> {
    const projectPath = parseProjectPathFromMrWebUrl(mrWebUrl);
    if (!projectPath) {
      diagnostic?.({
        ok: false,
        method: "GET",
        url: mrWebUrl,
        error: { status: 0, message: "无法从 mrWebUrl 解析项目路径" },
      });
      return [];
    }
    const apiPath = `/${projectPath}/-/merge_requests/${mrIid}/conflicts.json`;
    try {
      const res = await requestWithRetry(() =>
        this.http.get<any>(apiPath, {
          validateStatus: () => true,
        })
      );
      const data = res.data as any;
      const bodyKeys =
        data && typeof data === "object" ? Object.keys(data) : [];
      const bodyType = Array.isArray(data) ? "array" : typeof data;
      const status = res.status;
      const httpOk = status === 200;
      const responseHeaders = sanitizeHeaders(res.headers);
      const isHtml =
        bodyType === "string" &&
        typeof responseHeaders["content-type"] === "string" &&
        String(responseHeaders["content-type"]).includes("text/html");

      let error: GitLabApiError | undefined = undefined;
      if (!httpOk) {
        error = { status, message: `HTTP ${status}` };
      } else if (isHtml) {
        error = {
          status,
          message:
            "conflicts.json 返回 HTML（可能被重定向到登录页或权限不足），无法解析冲突文件列表",
        };
      } else if (!validateConflictsJsonStructure(data)) {
        error = {
          status,
          message: "conflicts.json 响应结构不符合预期（缺少 files 数组）",
        };
      }

      const structureValid =
        httpOk && !isHtml && validateConflictsJsonStructure(data);
      const filesCount = Array.isArray(data?.files)
        ? data.files.length
        : data?.files && typeof data.files === "object"
        ? Object.keys(data.files).length
        : undefined;
      const list = structureValid ? (data.files as unknown[]) : [];
      const normalized = normalizeConflictFiles(list);

      diagnostic?.({
        ok: httpOk && !isHtml && structureValid,
        method: "GET",
        url: `${this.baseUrl}${apiPath}`,
        status,
        requestHeaders: sanitizeHeaders((res.config as any)?.headers),
        responseHeaders,
        bodyKeys,
        bodyType,
        filesCount,
        error,
        structureValid,
      });

      if (status === 401 || status === 403) {
        throw new Error(
          `GitLab 认证/权限异常：HTTP ${status}（无法访问 conflicts.json）`
        );
      }
      if (!httpOk) return [];
      if (isHtml) return [];
      if (!structureValid) return [];
      return normalized;
    } catch (e) {
      const err = extractErrorMessage(e);
      const axiosErr = e as AxiosError;
      const status = axios.isAxiosError(axiosErr)
        ? axiosErr.response?.status
        : undefined;
      diagnostic?.({
        ok: false,
        method: "GET",
        url: `${this.baseUrl}${apiPath}`,
        status,
        requestHeaders: sanitizeHeaders((axiosErr as any)?.config?.headers),
        responseHeaders: sanitizeHeaders((axiosErr as any)?.response?.headers),
        error: err,
        bodyKeys:
          err?.data && typeof err.data === "object"
            ? Object.keys(err.data as any)
            : [],
        bodyType: Array.isArray(err?.data) ? "array" : typeof err?.data,
        structureValid: false,
      });
      return [];
    }
  }

  async getMergeRequestConflictForPathByMrWebUrl(
    mrWebUrl: string,
    mrIid: number,
    payload: { oldPath: string; newPath: string },
    diagnostic?: (info: {
      ok: boolean;
      method: string;
      url: string;
      status?: number;
      requestHeaders?: Record<string, unknown>;
      responseHeaders?: Record<string, unknown>;
      error?: GitLabApiError;
      bodyKeys?: string[];
      bodyType?: string;
    }) => void
  ): Promise<any | null> {
    const projectPath = parseProjectPathFromMrWebUrl(mrWebUrl);
    if (!projectPath) return null;
    const apiPath = `/${projectPath}/-/merge_requests/${mrIid}/conflict_for_path`;
    try {
      const res = await requestWithRetry(() =>
        this.http.get<any>(apiPath, {
          params: {
            old_path: payload.oldPath,
            new_path: payload.newPath,
          },
          validateStatus: (status) =>
            (status >= 200 && status < 300) || status === 404,
        })
      );
      const data = res.data as any;
      diagnostic?.({
        ok: true,
        method: "GET",
        url: `${this.baseUrl}${apiPath}`,
        status: res.status,
        requestHeaders: sanitizeHeaders((res.config as any)?.headers),
        responseHeaders: sanitizeHeaders(res.headers),
        bodyKeys: data && typeof data === "object" ? Object.keys(data) : [],
        bodyType: Array.isArray(data) ? "array" : typeof data,
      });
      if (res.status === 404) return null;
      return data ?? null;
    } catch (e) {
      const err = extractErrorMessage(e);
      const axiosErr = e as AxiosError;
      const status = axios.isAxiosError(axiosErr)
        ? axiosErr.response?.status
        : undefined;
      diagnostic?.({
        ok: false,
        method: "GET",
        url: `${this.baseUrl}${apiPath}`,
        status,
        requestHeaders: sanitizeHeaders((axiosErr as any)?.config?.headers),
        responseHeaders: sanitizeHeaders((axiosErr as any)?.response?.headers),
        error: err,
        bodyKeys:
          err?.data && typeof err.data === "object"
            ? Object.keys(err.data as any)
            : [],
        bodyType: Array.isArray(err?.data) ? "array" : typeof err?.data,
      });
      return null;
    }
  }

  async resolveMergeRequestConflictsByMrWebUrl(
    mrWebUrl: string,
    mrIid: number,
    payload: { commit_message: string; files: any[] },
    diagnostic?: (info: {
      ok: boolean;
      method: string;
      url: string;
      status?: number;
      requestHeaders?: Record<string, unknown>;
      responseHeaders?: Record<string, unknown>;
      error?: GitLabApiError;
      bodyKeys?: string[];
      bodyType?: string;
    }) => void
  ): Promise<
    | { ok: true; status: number; data: any }
    | { ok: false; status?: number; error?: GitLabApiError; data?: any }
  > {
    const projectPath = parseProjectPathFromMrWebUrl(mrWebUrl);
    if (!projectPath)
      return { ok: false, error: { status: 0, message: "无法解析项目路径" } };
    const apiPath = `/${projectPath}/-/merge_requests/${mrIid}/resolve_conflicts`;
    try {
      const res = await requestWithRetry(() =>
        this.http.post<any>(apiPath, payload, {
          validateStatus: (status) => status >= 200 && status < 500,
        })
      );
      const data = res.data as any;
      const ok = res.status >= 200 && res.status < 300;
      diagnostic?.({
        ok,
        method: "POST",
        url: `${this.baseUrl}${apiPath}`,
        status: res.status,
        requestHeaders: sanitizeHeaders((res.config as any)?.headers),
        responseHeaders: sanitizeHeaders(res.headers),
        bodyKeys: data && typeof data === "object" ? Object.keys(data) : [],
        bodyType: Array.isArray(data) ? "array" : typeof data,
      });
      if (ok) return { ok: true, status: res.status, data };
      return {
        ok: false,
        status: res.status,
        data,
        error: {
          status: res.status,
          message: `HTTP ${res.status}`,
          data,
        },
      };
    } catch (e) {
      const err = extractErrorMessage(e);
      const axiosErr = e as AxiosError;
      const status = axios.isAxiosError(axiosErr)
        ? axiosErr.response?.status
        : undefined;
      diagnostic?.({
        ok: false,
        method: "POST",
        url: `${this.baseUrl}${apiPath}`,
        status,
        requestHeaders: sanitizeHeaders((axiosErr as any)?.config?.headers),
        responseHeaders: sanitizeHeaders((axiosErr as any)?.response?.headers),
        error: err,
        bodyKeys:
          err?.data && typeof err.data === "object"
            ? Object.keys(err.data as any)
            : [],
        bodyType: Array.isArray(err?.data) ? "array" : typeof err?.data,
      });
      return { ok: false, status, error: err, data: err?.data };
    }
  }

  async getFileContent(
    projectId: number,
    filePath: string,
    ref: string
  ): Promise<string> {
    try {
      const res = await requestWithRetry(() =>
        this.http.get(
          `/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(
            filePath
          )}/raw`,
          {
            params: { ref },
            responseType: "text", // Ensure we get text content
          }
        )
      );
      return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    } catch (e) {
      console.error(`Failed to get file content: ${filePath} @ ${ref}`, e);
      throw e;
    }
  }

  async getMergeBase(
    projectId: number,
    refs: string[]
  ): Promise<string | null> {
    try {
      if (refs.length < 2) return null;
      const res = await requestWithRetry(() =>
        this.http.get<{ id: string }>(
          `/api/v4/projects/${projectId}/repository/merge_base`,
          {
            params: { refs },
          }
        )
      );
      return res.data?.id || null;
    } catch (e) {
      console.error("Failed to get merge base", e);
      return null;
    }
  }

  async createCommit(
    projectId: number,
    branch: string,
    message: string,
    actions: {
      action: "create" | "delete" | "move" | "update" | "chmod";
      file_path: string;
      previous_path?: string;
      content?: string;
      encoding?: "text" | "base64";
      last_commit_id?: string;
      execute_filemode?: boolean;
    }[]
  ): Promise<void> {
    const data = {
      branch,
      commit_message: message,
      actions,
    };
    await requestWithRetry(() =>
      this.http.post(`/api/v4/projects/${projectId}/repository/commits`, data)
    );
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

  async findOpenMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string
  ): Promise<GitLabMergeRequest | null> {
    try {
      const params = {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        state: "opened",
      };
      const res = await requestWithRetry(() =>
        this.http.get<GitLabMergeRequest[]>(
          `/api/v4/projects/${projectId}/merge_requests`,
          { params }
        )
      );
      return res.data?.[0] || null;
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
