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
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;

const gitlab = new GitLabClient();
const mergeService = new MergeService(gitlab);
const localGit = new LocalGitConflictService(gitlab);

// Map to store conflict resolvers: runId -> resolveFunction
const conflictResolvers = new Map<string, (res: any) => void>();

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
          // Send conflict event to renderer
          event.sender.send("gitlab:merge-conflict", {
            runId,
            ...conflictData,
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
    payload: { runId: string; filePath: string }
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

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = 1300;
  const minHeight = 700;
  const desiredWidth = 1300;
  const desiredHeight = 700;
  const width = Math.max(minWidth, Math.min(desiredWidth, workArea.width));
  const height = Math.max(minHeight, Math.min(desiredHeight, workArea.height));

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "icon.png"),
    width,
    height,
    minWidth,
    minHeight,
    maxWidth: 1600,
    maxHeight: 1200,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.center();

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
