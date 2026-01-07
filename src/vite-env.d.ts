/// <reference types="vite/client" />

interface Window {
  ipcRenderer?: import("electron").IpcRenderer;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
