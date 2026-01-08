import { describe, expect, it, vi } from "vitest";

let exposed: any = null;

const on = vi.fn();
const off = vi.fn();
const removeAllListeners = vi.fn();
const send = vi.fn();
const invoke = vi.fn();

vi.mock("electron", () => {
  return {
    ipcRenderer: { on, off, removeAllListeners, send, invoke },
    contextBridge: {
      exposeInMainWorld: (_key: string, api: any) => {
        (globalThis as any).ipcRenderer = api;
        exposed = api;
      },
    },
  };
});

describe("preload ipcRenderer wrapper", () => {
  it("off 会注销 on 注册的同一 listener", async () => {
    vi.resetModules();
    on.mockClear();
    off.mockClear();
    removeAllListeners.mockClear();
    exposed = null;

    await import("../electron/preload");

    const handler = vi.fn();
    exposed.on("c", handler);
    expect(on).toHaveBeenCalledTimes(1);
    const wrapped = on.mock.calls[0][1];

    exposed.off("c", handler);
    expect(off).toHaveBeenCalledTimes(1);
    expect(off.mock.calls[0][0]).toBe("c");
    expect(off.mock.calls[0][1]).toBe(wrapped);
  });

  it("重复 on 同一 listener 时，off 可逐次注销", async () => {
    vi.resetModules();
    on.mockClear();
    off.mockClear();
    removeAllListeners.mockClear();
    exposed = null;

    await import("../electron/preload");

    const handler = vi.fn();
    exposed.on("c", handler);
    exposed.on("c", handler);
    expect(on).toHaveBeenCalledTimes(2);
    const wrapped = on.mock.calls[0][1];
    expect(on.mock.calls[1][1]).toBe(wrapped);

    exposed.off("c", handler);
    exposed.off("c", handler);
    expect(off).toHaveBeenCalledTimes(2);
    expect(off.mock.calls[0][1]).toBe(wrapped);
    expect(off.mock.calls[1][1]).toBe(wrapped);
  });

  it("off 未找到映射时会按原始 listener 调用", async () => {
    vi.resetModules();
    on.mockClear();
    off.mockClear();
    removeAllListeners.mockClear();
    exposed = null;

    await import("../electron/preload");

    const handler = vi.fn();
    exposed.off("c2", handler);
    expect(off).toHaveBeenCalledTimes(1);
    expect(off.mock.calls[0][0]).toBe("c2");
    expect(off.mock.calls[0][1]).toBe(handler);
  });
});
