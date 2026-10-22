import { app, BrowserWindow, ipcMain, screen, session, shell } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CnbClient } from "../src/main/services/cnbClient";
import { MergeService } from "../src/main/services/mergeService";
import {
  RELEASES_PAGE_URL,
  fetchLatestRelease,
  isNewerVersion,
} from "../src/main/services/updateChecker";
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

/** 退出登录：清空主进程持有的令牌与网页会话 Cookie。 */
ipcMain.handle("cnb:clear-auth", async () => {
  cnb.clearToken();
  cnb.setWebCookie("");
  return { ok: true };
});

// ---------- 应用更新检查（GitHub Release，提示但不强制更新） ----------

export interface UpdateStatus {
  checking: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  releaseUrl: string;
  error: string;
}

let updateStatus: UpdateStatus | null = null;

function pushUpdateStatus(status: UpdateStatus) {
  updateStatus = status;
  try {
    win?.webContents?.send?.("cnb:update-status", status);
  } catch {
    /* 窗口可能尚未创建/已销毁，忽略 */
  }
}

async function runUpdateCheck() {
  const current = app.getVersion();
  pushUpdateStatus({
    checking: true,
    current,
    latest: updateStatus?.latest || "",
    hasUpdate: updateStatus?.hasUpdate || false,
    releaseUrl: updateStatus?.releaseUrl || RELEASES_PAGE_URL,
    error: "",
  });
  try {
    const rel = await fetchLatestRelease();
    pushUpdateStatus({
      checking: false,
      current,
      latest: rel.version,
      hasUpdate: isNewerVersion(current, rel.version),
      releaseUrl: rel.htmlUrl,
      error: "",
    });
  } catch (err: any) {
    pushUpdateStatus({
      checking: false,
      current,
      latest: updateStatus?.latest || "",
      hasUpdate: updateStatus?.hasUpdate || false,
      releaseUrl: updateStatus?.releaseUrl || RELEASES_PAGE_URL,
      error: err?.message ? `检查更新失败: ${err.message}` : "检查更新失败",
    });
  }
}

ipcMain.handle("cnb:app-version", () => app.getVersion());

ipcMain.handle("cnb:get-update-status", () => updateStatus);

ipcMain.handle("cnb:check-update", async () => {
  await runUpdateCheck();
  return updateStatus;
});

/**
 * 打开内嵌网页登录窗口：用户在窗口内正常登录 CNB（密码/扫码/passkey），
 * 登录成功后自动抓取会话 Cookie 返回给渲染层持久化。
 * Cookie 模式下所有 API 走 https://cnb.cool 同源接口，无需访问令牌。
 */
let loginWin: BrowserWindow | null = null;

ipcMain.handle(
  "cnb:web-login",
  async (_event: IpcMainInvokeEvent, payload?: { forceFresh?: boolean }) => {
    if (loginWin) {
      loginWin.focus();
      return { ok: false, error: "登录窗口已打开，请完成登录" };
    }
    const ses = session.fromPartition("persist:cnb-web-login");
    // 切换账号：清空持久化网页会话（Cookie/本地存储等），确保弹出全新登录页
    if (payload?.forceFresh) {
      try {
        await ses.clearStorageData({
          storages: [
            "cookies",
            "localstorage",
            "indexdb",
            "serviceworkers",
            "cachestorage",
          ],
        });
      } catch {
        /* ignore */
      }
    }
    return await new Promise<any>((resolve) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 1024,
      height: 760,
      title: "登录 CNB",
      autoHideMenuBar: true,
      // 页面渲染完成后再显示，避免打开登录窗时白屏
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: { session: ses, contextIsolation: true },
    });
    win.once("ready-to-show", () => win.show());
    // 兜底：远程页面加载异常时也要保证窗口可见
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 5000);
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

    // 主页加载完成后自动点击「微信登录 / WeChat Login」按钮，直接弹出登录框
    // （CNB 无独立登录页，/login 会 404；登录框是主页上的模态框）
    const autoOpenWechatLogin = async () => {
      for (let i = 0; i < 20; i++) {
        try {
          const clicked = await win.webContents.executeJavaScript(
            `(() => {
              const keys = ['微信登录', '微信登陆', 'wechat login'];
              const els = Array.from(document.querySelectorAll('a, button, [role="button"]'));
              const btn = els.find((el) => {
                const t = (el.textContent || '').trim().toLowerCase();
                if (!t || t.length > 30) return false;
                return keys.some((k) => t === k || t.includes(k));
              });
              if (btn) { btn.click(); return true; }
              return false;
            })()`,
            true
          );
          if (clicked) return;
        } catch {
          /* ignore, 等待下一轮 */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    win.webContents.on("did-finish-load", () => {
      const url = win.webContents.getURL();
      // 仅在中文主页（登录入口所在页）自动点击，登录后的跳转不处理
      try {
        const u = new URL(url);
        if (
          u.hostname === "cnb.cool" &&
          (u.pathname === "/" || u.pathname === "")
        ) {
          void autoOpenWechatLogin();
        }
      } catch {
        /* ignore */
      }
    });

    void win.loadURL("https://cnb.cool/?lang=zh-CN");
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
    // 分支按最新提交时间倒序（最近提交的在前），便于挑选活跃分支
    const branches = await cnb.getBranchesSortedByCommitTime(payload.repo);
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

  return { width, height, minWidth, minHeight };
}

/**
 * 固定页面缩放 100%：
 * - 禁用触控板捏合缩放（setVisualZoomLevelLimits）
 * - Ctrl+滚轮触发的 zoom-changed 一律重置回 1
 * 应用无菜单栏，用户误触缩放后没有任何恢复入口，故直接固定。
 */
function pinZoomLevel(wc: WebContents) {
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {
    /* 旧版本 API 可能不存在，忽略 */
  });
  wc.on("zoom-changed", () => {
    wc.setZoomFactor(1);
  });
}

function createWindow() {
  const initial = computeInitialWindowBounds();

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "icon.png"),
    width: initial.width,
    height: initial.height,
    minWidth: initial.minWidth,
    minHeight: initial.minHeight,
    // 先隐藏窗口，页面首次渲染完成后再显示，避免启动白屏
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.once("ready-to-show", () => {
    win?.show();
  });
  // 兜底：极端情况下 ready-to-show 不触发，3 秒后强制显示
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 3000);

  win.center();

  // 固定页面缩放 100%（防误触 Ctrl+滚轮 / 触控板捏合）
  pinZoomLevel(win.webContents);

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

app.whenReady().then(() => {
  createWindow();
  // 自动检查更新：启动后延迟 3 秒（不阻塞启动），之后每 6 小时一次。
  // 仅提示（渲染层角标/弹层），不自动下载、不强制更新。
  setTimeout(() => void runUpdateCheck().catch(() => {}), 3000);
  setInterval(() => void runUpdateCheck().catch(() => {}), 6 * 60 * 60 * 1000);
});
