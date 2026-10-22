import { app, BrowserWindow, ipcMain, screen, session, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CnbClient } from "../src/main/services/cnbClient";
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

const cnb = new CnbClient();
const mergeService = new MergeService(cnb);

ipcMain.handle(
  "cnb:set-auth",
  async (
    _event: IpcMainInvokeEvent,
    payload: {
      baseUrl: string;
      token: string;
      webCookie?: string;
      mode?: "token" | "cookie";
    }
  ) => {
    if (payload.mode === "cookie" && payload.webCookie) {
      // Cookie 模式：走 cnb.cool 同源 API，无需访问令牌
      cnb.setBaseUrl(payload.baseUrl || "https://cnb.cool");
      cnb.setCookieAuth(payload.webCookie);
    } else {
      // 令牌模式：走 api.cnb.cool
      cnb.setBaseUrl(payload.baseUrl);
      cnb.setToken(payload.token);
      if (payload.webCookie) cnb.setWebCookie(payload.webCookie);
    }
    const res = await cnb.verifyToken();
    return res;
  }
);

/**
 * 打开内嵌网页登录窗口：用户在窗口内正常登录 CNB（密码/扫码/passkey），
 * 登录成功后自动抓取会话 Cookie 返回给渲染层持久化。
 * Cookie 模式下所有 API 走 https://cnb.cool 同源接口，无需访问令牌。
 */
let loginWin: BrowserWindow | null = null;

ipcMain.handle("cnb:web-login", async () => {
  if (loginWin) {
    loginWin.focus();
    return { ok: false, error: "登录窗口已打开，请完成登录" };
  }
  const ses = session.fromPartition("persist:cnb-web-login");
  return await new Promise<any>((resolve) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 1024,
      height: 760,
      title: "登录 CNB",
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true },
    });
    loginWin = win;

    const settle = (result: any) => {
      if (settled) return;
      settled = true;
      resolve(result);
      try {
        win.close();
      } catch {
        /* ignore */
      }
    };

    // 每次页面跳转后尝试检查登录态：能拿到 cookie 且 GET /user 通过即成功
    const checkLogin = async () => {
      try {
        const cookies = await ses.cookies.get({ domain: "cnb.cool" });
        const cookieStr = cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        if (!cookieStr) return;
        const test = await cnb.testWebCookie(cookieStr);
        if (test.ok) {
          settle({ ok: true, cookie: cookieStr, user: test.user });
        }
      } catch {
        /* ignore, 等下一次导航再检查 */
      }
    };

    win.webContents.on("did-navigate", () => void checkLogin());
    win.webContents.on("did-navigate-in-page", () => void checkLogin());
    win.on("closed", () => {
      loginWin = null;
      if (!settled) settle({ ok: false, error: "登录窗口已关闭" });
    });

    void win.loadURL("https://cnb.cool/login");
  });
});

/**
 * 置顶/取消置顶仓库（写回 CNB 网页 dashboard，实现双向同步）。
 * 需要已配置有效的网页会话 Cookie（cnb:set-auth 时传入）。
 */
ipcMain.handle(
  "cnb:set-repo-pinned",
  async (
    _event: IpcMainInvokeEvent,
    payload: { repo: string; pinned: boolean }
  ) => {
    return cnb.setRepoPinned(payload.repo, payload.pinned);
  }
);

ipcMain.handle(
  "cnb:list-projects",
  async (): Promise<ListProjectsResponse> => {
    const repos = await cnb.getAllRepos();
    const items = repos
      .map((r) => {
        const display = (r.path || r.name || "").toString();
        const id = display;
        if (!display) return null;
        return {
          id,
          display,
          search: display.toLowerCase(),
          pinyinFull: "",
          pinyinInitials: "",
          pinned: r.pinned === true,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => a.search.localeCompare(b.search));
    return { items };
  }
);

ipcMain.handle(
  "cnb:list-branches",
  async (
    _event: IpcMainInvokeEvent,
    payload: { repo: string }
  ): Promise<ListBranchesResponse> => {
    const branches = await cnb.getBranches(payload.repo);
    const names = branches
      .map((b) => b.name)
      .filter((x): x is string => Boolean(x));
    return { branches: names };
  }
);

ipcMain.handle(
  "cnb:batch-merge",
  async (
    event: IpcMainInvokeEvent,
    payload: BatchMergeRequest
  ): Promise<BatchMergeResponse> => {
    const runId = payload.runId || "unknown";
    return await mergeService.runBatchMerge(payload.repo, payload.pairs, {
      onLog: (text, error) => {
        event.sender.send("cnb:batch-merge-log", { runId, text, error });
      },
    });
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
