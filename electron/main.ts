import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { GitLabClient } from "../src/main/services/gitlabClient";
import { LocalGitConflictService } from "../src/main/services/localGitConflictService";
import { MergeService } from "../src/main/services/mergeService";
import type {
  BatchMergeRequest,
  BatchMergeResponse,
  ListBranchesResponse,
  ListProjectsResponse,
} from "../src/renderer/ipc/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;
let screenListenersAttached = false;

const gitlab = new GitLabClient();
const mergeService = new MergeService(gitlab);
const localGit = new LocalGitConflictService(gitlab);

// Map to store conflict resolvers: runId -> resolveFunction
const conflictResolvers = new Map<string, (res: any) => void>();

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

function mergeConflictFiles(a: any[], b: any[]) {
  const map = new Map<string, any>();
  for (const it of normalizeConflictFiles(a)) map.set(String(it.new_path), it);
  for (const it of normalizeConflictFiles(b)) {
    const key = String(it.new_path);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, it);
      continue;
    }
    const merged: any = { ...prev };
    for (const [k, v] of Object.entries(it)) {
      if (v !== undefined) merged[k] = v;
    }
    map.set(key, merged);
  }
  return Array.from(map.values());
}

ipcMain.handle(
  "gitlab:set-auth",
  async (
    _event: IpcMainInvokeEvent,
    payload: { baseUrl: string; token: string }
  ) => {
    gitlab.setBaseUrl(payload.baseUrl);
    gitlab.setToken(payload.token);
    const res = await gitlab.verifyToken();
    return res;
  }
);

ipcMain.handle(
  "gitlab:list-projects",
  async (): Promise<ListProjectsResponse> => {
    const projects = await gitlab.getAllProjects();
    const items = projects
      .map((p) => {
        const display = (p.name_with_namespace || p.name || "").toString();
        const id = Number(p.id);
        if (!display || !id) return null;
        return {
          id,
          display,
          search: display.toLowerCase(),
          pinyinFull: "",
          pinyinInitials: "",
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.search.localeCompare(b.search));
    return { items };
  }
);

ipcMain.handle(
  "gitlab:list-branches",
  async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: number }
  ): Promise<ListBranchesResponse> => {
    const branches = await gitlab.getBranches(payload.projectId);
    const names = branches
      .map((b) => b.name)
      .filter((x): x is string => Boolean(x));
    return { branches: names };
  }
);

ipcMain.handle(
  "gitlab:batch-merge",
  async (
    event: IpcMainInvokeEvent,
    payload: BatchMergeRequest
  ): Promise<BatchMergeResponse> => {
    const runId = payload.runId || "unknown";

    // Cleanup old resolvers
    if (conflictResolvers.has(runId)) {
      conflictResolvers.delete(runId);
    }

    const res = await mergeService.runAtomicBatchMerge(
      payload.projectId,
      payload.pairs,
      {
        onLog: (text, error) => {
          event.sender.send("gitlab:batch-merge-log", { runId, text, error });
        },
        conflictHandler: async (conflictData) => {
          let conflictFiles = Array.isArray((conflictData as any)?.conflicts)
            ? ((conflictData as any).conflicts as any[])
            : [];

          const d = (conflictData as any)?.mrDetails;
          const looksConflicted =
            d?.has_conflicts ||
            d?.detailed_merge_status === "conflicts" ||
            d?.merge_status === "cannot_be_merged";

          const pid = Number((conflictData as any).projectId || 0);
          const iid = Number((conflictData as any).mrIid || 0);
          const mrWebUrl = String((conflictData as any).mrWebUrl || "");

          if (looksConflicted && pid && iid) {
            try {
              let fullList: any[] = [];
              if (mrWebUrl) {
                const [v4, json] = await Promise.all([
                  gitlab.getMergeRequestConflicts(pid, iid),
                  gitlab.getMergeRequestConflictsJsonByMrWebUrl(mrWebUrl, iid),
                ]);
                fullList = mergeConflictFiles(v4, json);
              } else {
                fullList = await gitlab.getMergeRequestConflicts(pid, iid);
              }
              if (fullList.length > conflictFiles.length) {
                conflictFiles = fullList;
                event.sender.send("gitlab:batch-merge-log", {
                  runId,
                  text: `已从 GitLab 拉取冲突文件列表：${conflictFiles.length} 个`,
                  error: false,
                });
              }
            } catch (e) {
              event.sender.send("gitlab:batch-merge-log", {
                runId,
                text: `拉取 GitLab 冲突文件列表失败：${String(e)}`,
                error: true,
              });
            }
          }

          // Send conflict event to renderer
          const autoLocalGitDetect = !conflictFiles.length && looksConflicted;
          if (autoLocalGitDetect) {
            event.sender.send("gitlab:batch-merge-log", {
              runId,
              text: "GitLab 冲突列表为空，可在界面中异步触发本地 Git 检测。",
              error: false,
            });
          }
          event.sender.send("gitlab:merge-conflict", {
            runId,
            ...conflictData,
            conflicts: conflictFiles,
            autoLocalGitDetect,
          });

          // Wait for resolution
          return new Promise((resolve) => {
            conflictResolvers.set(runId, resolve);
          });
        },
      }
    );
    return res;
  }
);

ipcMain.handle(
  "gitlab:resolve-conflict",
  async (
    _event: IpcMainInvokeEvent,
    payload: { runId: string; resolution: any }
  ) => {
    await localGit.cleanup(payload.runId);
    const resolve = conflictResolvers.get(payload.runId);
    if (resolve) {
      resolve(payload.resolution);
      conflictResolvers.delete(payload.runId);
      return { ok: true };
    }
    return { ok: false, error: "No active conflict resolution found" };
  }
);

ipcMain.handle(
  "localgit:prepare-conflicts",
  async (
    _event: IpcMainInvokeEvent,
    payload: {
      runId: string;
      projectId: number;
      source: string;
      target: string;
      mrWebUrl?: string;
    }
  ) => {
    return await localGit.prepare(payload);
  }
);

ipcMain.handle(
  "localgit:get-file-contents",
  async (
    _event: IpcMainInvokeEvent,
    payload: {
      runId: string;
      filePath: string;
      targetPath?: string;
      sourcePath?: string;
      basePath?: string;
    }
  ) => {
    return await localGit.getFileContents(payload);
  }
);

ipcMain.handle(
  "localgit:merge-file-contents",
  async (
    _event: IpcMainInvokeEvent,
    payload: {
      base: string;
      left: string;
      right: string;
      labels?: { left?: string; base?: string; right?: string };
      diff3?: boolean;
    }
  ) => {
    return await localGit.mergeFileContents(payload);
  }
);

ipcMain.handle(
  "localgit:cleanup",
  async (_event: IpcMainInvokeEvent, payload: { runId: string }) => {
    return await localGit.cleanup(payload.runId);
  }
);

ipcMain.handle(
  "gitlab:get-file-content",
  async (
    _event,
    payload: { projectId: number; filePath: string; ref: string }
  ) => {
    return await gitlab.getFileContent(
      payload.projectId,
      payload.filePath,
      payload.ref
    );
  }
);

ipcMain.handle(
  "gitlab:get-file-metadata",
  async (
    _event,
    payload: { projectId: number; filePath: string; ref: string }
  ) => {
    return await gitlab.getFileMetadata(
      payload.projectId,
      payload.filePath,
      payload.ref
    );
  }
);

ipcMain.handle(
  "gitlab:get-merge-request-changes",
  async (_event, payload: { projectId: number; mrIid: number }) => {
    return await gitlab.getMergeRequestChanges(
      payload.projectId,
      payload.mrIid
    );
  }
);

ipcMain.handle(
  "gitlab:get-merge-request-conflicts",
  async (_event, payload: { projectId: number; mrIid: number }) => {
    return await gitlab.getMergeRequestConflicts(
      payload.projectId,
      payload.mrIid
    );
  }
);

ipcMain.handle(
  "gitlab:get-merge-request-conflicts-full",
  async (
    _event,
    payload: { projectId: number; mrIid: number; mrWebUrl: string }
  ) => {
    const pid = Number(payload.projectId || 0);
    const iid = Number(payload.mrIid || 0);
    const mrWebUrl = String(payload.mrWebUrl || "");
    if (!pid || !iid || !mrWebUrl) return [];
    const [v4, json] = await Promise.all([
      gitlab.getMergeRequestConflicts(pid, iid),
      gitlab.getMergeRequestConflictsJsonByMrWebUrl(mrWebUrl, iid),
    ]);
    return mergeConflictFiles(v4, json);
  }
);

ipcMain.handle(
  "gitlab:get-conflict-for-path",
  async (
    _event,
    payload: {
      mrWebUrl: string;
      mrIid: number;
      oldPath: string;
      newPath: string;
    }
  ) => {
    return await gitlab.getMergeRequestConflictForPathByMrWebUrl(
      payload.mrWebUrl,
      payload.mrIid,
      { oldPath: payload.oldPath, newPath: payload.newPath }
    );
  }
);

ipcMain.handle(
  "gitlab:resolve-conflicts",
  async (
    _event,
    payload: {
      mrWebUrl: string;
      mrIid: number;
      commit_message: string;
      files: any[];
    }
  ) => {
    return await gitlab.resolveMergeRequestConflictsByMrWebUrl(
      payload.mrWebUrl,
      payload.mrIid,
      { commit_message: payload.commit_message, files: payload.files }
    );
  }
);

ipcMain.handle(
  "gitlab:get-merge-request",
  async (_event, payload: { projectId: number; mrIid: number }) => {
    return await gitlab.getMergeRequest(payload.projectId, payload.mrIid);
  }
);

ipcMain.handle(
  "gitlab:create-commit",
  async (
    _event,
    payload: {
      projectId: number;
      branch: string;
      message: string;
      actions: any[];
    }
  ) => {
    return await gitlab.createCommit(
      payload.projectId,
      payload.branch,
      payload.message,
      payload.actions
    );
  }
);

ipcMain.handle(
  "gitlab:get-merge-base",
  async (_event, payload: { projectId: number; refs: string[] }) => {
    return await gitlab.getMergeBase(payload.projectId, payload.refs);
  }
);

ipcMain.handle("shell:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeInitialWindowBounds() {
  const display = screen.getPrimaryDisplay();
  const wa = display.workAreaSize;
  const waW = Math.max(0, Number(wa.width || 0));
  const waH = Math.max(0, Number(wa.height || 0));

  const phi = 1.618;
  const hardMaxW = Math.round(1000 * phi);

  const baseMinW = 980;
  const baseMinH = 640;
  const minWidth = Math.min(baseMinW, waW || baseMinW);
  const minHeight = Math.min(baseMinH, waH || baseMinH);

  const maxWidth = Math.max(minWidth, waW || minWidth);
  const maxHeight = Math.max(minHeight, waH || minHeight);

  let width = Math.min(Math.round(maxWidth * 0.92), hardMaxW);
  let height = Math.round(width / phi);

  const capH = Math.round(maxHeight * 0.92);
  if (height > capH) {
    height = capH;
    width = Math.round(height * phi);
  }

  width = clamp(width, minWidth, maxWidth);
  height = clamp(height, minHeight, maxHeight);

  return { width, height, minWidth, minHeight, maxWidth, maxHeight };
}

function clampWindowToWorkArea() {
  if (!win) return;
  if (win.isDestroyed()) return;
  if (win.isMaximized() || win.isFullScreen()) return;

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const wa = display.workArea;

  const [minW, minH] = win.getMinimumSize();
  const maxW = Math.max(minW, wa.width);
  const maxH = Math.max(minH, wa.height);

  const width = clamp(bounds.width, minW, maxW);
  const height = clamp(bounds.height, minH, maxH);
  const x = clamp(bounds.x, wa.x, wa.x + wa.width - width);
  const y = clamp(bounds.y, wa.y, wa.y + wa.height - height);

  win.setBounds({ x, y, width, height });
  win.setMaximumSize(maxW, maxH);
}

function createWindow() {
  const initial = computeInitialWindowBounds();

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "icon.png"),
    width: initial.width,
    height: initial.height,
    minWidth: initial.minWidth,
    minHeight: initial.minHeight,
    maxWidth: initial.maxWidth,
    maxHeight: initial.maxHeight,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.center();
  win.setMaximumSize(initial.maxWidth, initial.maxHeight);
  win.on("move", clampWindowToWorkArea);
  win.on("resize", clampWindowToWorkArea);

  if (!screenListenersAttached) {
    screen.on("display-added", clampWindowToWorkArea);
    screen.on("display-removed", clampWindowToWorkArea);
    screen.on("display-metrics-changed", clampWindowToWorkArea);
    screenListenersAttached = true;
  }

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);
