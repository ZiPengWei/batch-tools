import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GitLabClient } from "./gitlabClient";

type RunGitResult = { code: number; stdout: string; stderr: string };
type RunGit = (cwd: string, args: string[]) => Promise<RunGitResult>;

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

function pickRemoteUrl(project: any, mrWebUrl?: string) {
  const ssh =
    typeof project?.ssh_url_to_repo === "string" ? project.ssh_url_to_repo : "";
  const http =
    typeof project?.http_url_to_repo === "string"
      ? project.http_url_to_repo
      : "";
  if (ssh.trim())
    return { url: ssh.trim(), source: "project.ssh_url_to_repo" as const };
  if (http.trim())
    return { url: http.trim(), source: "project.http_url_to_repo" as const };
  if (mrWebUrl) {
    const projectPath = parseProjectPathFromMrWebUrl(mrWebUrl);
    if (projectPath) {
      const u = new URL(mrWebUrl);
      const guessed = `${u.origin}/${projectPath}.git`;
      return { url: guessed, source: "mrWebUrl" as const };
    }
  }
  return { url: "", source: "none" as const };
}

function defaultRunGit(): RunGit {
  return async (cwd: string, args: string[]) => {
    return await new Promise<RunGitResult>((resolve) => {
      const child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (d) => (stdout += String(d)));
      child.stderr?.on("data", (d) => (stderr += String(d)));
      child.on("close", (code) => {
        resolve({ code: Number(code ?? 0), stdout, stderr });
      });
      child.on("error", () => {
        resolve({ code: 1, stdout, stderr: stderr || "spawn git failed" });
      });
    });
  };
}

export class LocalGitConflictService {
  private runs = new Map<
    string,
    {
      repoDir: string;
      projectId: number;
      source: string;
      target: string;
      baseSha: string | null;
      remoteUrl: string;
    }
  >();
  private baseDir: string;
  private runGit: RunGit;
  private client: GitLabClient;

  constructor(
    client: GitLabClient,
    opts?: { baseDir?: string; runGit?: RunGit }
  ) {
    this.client = client;
    this.baseDir =
      opts?.baseDir || path.join(os.tmpdir(), "gitlab-batch-merge-tool");
    this.runGit = opts?.runGit || defaultRunGit();
  }

  async cleanup(runId: string) {
    const st = this.runs.get(runId);
    if (!st) return { ok: true as const };
    this.runs.delete(runId);
    try {
      await fs.rm(st.repoDir, { recursive: true, force: true });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  }

  async prepare(payload: {
    runId: string;
    projectId: number;
    source: string;
    target: string;
    mrWebUrl?: string;
  }) {
    const { runId, projectId, source, target, mrWebUrl } = payload;

    await this.cleanup(runId);
    await fs.mkdir(this.baseDir, { recursive: true });
    const repoDir = await fs.mkdtemp(path.join(this.baseDir, `run-${runId}-`));

    let project: any = null;
    let projectErr: unknown = null;
    try {
      project = await (this.client as any).getProject?.(projectId);
    } catch (e) {
      projectErr = e;
      project = null;
    }
    const pick = pickRemoteUrl(project, mrWebUrl);
    const remoteUrl = pick.url;
    if (!remoteUrl) {
      await fs.rm(repoDir, { recursive: true, force: true });
      return {
        ok: false as const,
        error:
          "无法确定仓库 clone 地址（缺少 project repo url 且无法从 MR URL 推断）",
        details: { projectErr: projectErr ? String(projectErr) : null },
      };
    }

    const cloneRes = await this.runGit(path.dirname(repoDir), [
      "clone",
      "--no-tags",
      "--depth",
      "50",
      "--branch",
      target,
      "--single-branch",
      remoteUrl,
      repoDir,
    ]);
    if (cloneRes.code !== 0) {
      await fs.rm(repoDir, { recursive: true, force: true });
      return {
        ok: false as const,
        error: "git clone 失败（请确认本机已安装 git 且具备仓库读取权限）",
        details: {
          stderr: cloneRes.stderr.slice(0, 4000),
          source: pick.source,
        },
      };
    }

    await this.runGit(repoDir, [
      "fetch",
      "--no-tags",
      "--depth",
      "50",
      "origin",
      source,
    ]);
    await this.runGit(repoDir, [
      "fetch",
      "--no-tags",
      "--depth",
      "50",
      "origin",
      target,
    ]);

    const baseRes = await this.runGit(repoDir, [
      "merge-base",
      `origin/${source}`,
      `origin/${target}`,
    ]);
    const baseSha =
      baseRes.code === 0 ? (baseRes.stdout || "").trim() || null : null;

    const checkoutRes = await this.runGit(repoDir, [
      "checkout",
      "-B",
      "__gbmt_target",
      `origin/${target}`,
    ]);
    if (checkoutRes.code !== 0) {
      await fs.rm(repoDir, { recursive: true, force: true });
      return {
        ok: false as const,
        error: "git checkout 失败",
        details: { stderr: checkoutRes.stderr.slice(0, 4000) },
      };
    }

    const mergeRes = await this.runGit(repoDir, [
      "merge",
      "--no-commit",
      "--no-ff",
      `origin/${source}`,
    ]);
    const mergeOk = mergeRes.code === 0 || mergeRes.code === 1;
    if (!mergeOk) {
      await fs.rm(repoDir, { recursive: true, force: true });
      return {
        ok: false as const,
        error: "git merge 失败",
        details: { stderr: mergeRes.stderr.slice(0, 4000) },
      };
    }

    const diffRes = await this.runGit(repoDir, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]);
    const conflictPaths = (diffRes.stdout || "")
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter((s) => Boolean(s));

    await this.runGit(repoDir, ["merge", "--abort"]);

    this.runs.set(runId, {
      repoDir,
      projectId,
      source,
      target,
      baseSha,
      remoteUrl,
    });

    return {
      ok: true as const,
      repoDir,
      baseSha,
      conflicts: conflictPaths.map((p) => ({ type: "text", new_path: p })),
      diagnostics: {
        remoteSource: pick.source,
        conflictsCount: conflictPaths.length,
      },
    };
  }

  async getFileContents(payload: { runId: string; filePath: string }) {
    const st = this.runs.get(payload.runId);
    if (!st)
      return { ok: false as const, error: "本地 git 会话不存在或已清理" };
    const filePath = payload.filePath;
    const safePath = String(filePath || "").replace(/^\/+/, "");

    const readAt = async (ref: string | null) => {
      if (!ref) return "";
      const r = await this.runGit(st.repoDir, ["show", `${ref}:${safePath}`]);
      if (r.code !== 0) return "";
      const s = r.stdout || "";
      return s.includes("\u0000") ? "" : s;
    };

    const [base, left, right] = await Promise.all([
      readAt(st.baseSha),
      readAt(`origin/${st.target}`),
      readAt(`origin/${st.source}`),
    ]);

    return { ok: true as const, base, left, right, baseSha: st.baseSha };
  }

  async mergeFileContents(payload: {
    base: string;
    left: string;
    right: string;
    labels?: { left?: string; base?: string; right?: string };
    diff3?: boolean;
  }) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tempDir = await fs.mkdtemp(path.join(this.baseDir, `merge-file-`));
    const leftPath = path.join(tempDir, "left");
    const basePath = path.join(tempDir, "base");
    const rightPath = path.join(tempDir, "right");
    try {
      await Promise.all([
        fs.writeFile(leftPath, String(payload.left ?? ""), "utf8"),
        fs.writeFile(basePath, String(payload.base ?? ""), "utf8"),
        fs.writeFile(rightPath, String(payload.right ?? ""), "utf8"),
      ]);

      const args: string[] = ["merge-file", "-p"];
      if (payload.diff3 !== false) args.push("--diff3");
      const l = payload.labels?.left?.trim();
      const b = payload.labels?.base?.trim();
      const r = payload.labels?.right?.trim();
      if (l) args.push("-L", l);
      if (b) args.push("-L", b);
      if (r) args.push("-L", r);
      args.push(leftPath, basePath, rightPath);

      const res = await this.runGit(tempDir, args);
      if (res.code !== 0 && res.code !== 1) {
        return {
          ok: false as const,
          error: "git merge-file 失败",
          details: { stderr: res.stderr.slice(0, 4000) },
        };
      }
      return {
        ok: true as const,
        merged: String(res.stdout ?? ""),
        hasConflicts: res.code === 1,
        diagnostics: { stderr: (res.stderr || "").slice(0, 2000) },
      };
    } catch (e) {
      return { ok: false as const, error: String(e ?? "Unknown error") };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
