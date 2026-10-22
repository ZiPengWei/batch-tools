import { defineStore } from "pinia";
import { listBranches, listProjects } from "../ipc/bridge";
import type { ListProjectsItem } from "../ipc/types";

const isE2E =
  (import.meta as any).env?.VITE_E2E === "1" ||
  String((import.meta as any).env?.MODE || "").toLowerCase() === "e2e";

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    items: [] as ListProjectsItem[],
    loading: false,
    error: "",

    filter: "",

    /** 当前选中的仓库完整路径（org/repo） */
    selectedRepo: "",
    selectedProjectName: "",

    sourceBranches: [] as string[],
    sourceBranchesLoading: false,
    sourceBranchesError: "",
    targetBranches: [] as string[],
    targetBranchesLoading: false,
    targetBranchesError: "",
    selectedSourceBranch: "",
  }),
  getters: {
    filteredItems(state) {
      const q = (state.filter || "").trim().toLowerCase();
      if (!q) return state.items;
      return state.items.filter((p) => {
        const s = p.search || p.display.toLowerCase();
        if (s.includes(q)) return true;
        return isSubsequence(q, s);
      });
    },
  },
  actions: {
    reset() {
      this.items = [];
      this.loading = false;
      this.error = "";
      this.filter = "";
      this.selectedRepo = "";
      this.selectedProjectName = "";
      this.sourceBranches = [];
      this.sourceBranchesLoading = false;
      this.sourceBranchesError = "";
      this.targetBranches = [];
      this.targetBranchesLoading = false;
      this.targetBranchesError = "";
      this.selectedSourceBranch = "";
    },
    setFilter(text: string) {
      this.filter = text;
    },
    async loadProjects() {
      this.loading = true;
      this.error = "";
      try {
        if (isE2E) {
          const items = Array.from({ length: 1200 }, (_, i) => {
            const id = i + 1;
            return {
              id: `demo/p${id}`,
              display: `demo/p${id}`,
              search: `demo/p${id}`,
              pinyinFull: "",
              pinyinInitials: "",
            } satisfies ListProjectsItem;
          });
          this.items = items;
          if (!this.selectedRepo) {
            await this.selectProject({ id: items[0].id, display: items[0].display });
          }
          return;
        }
        const res = await listProjects();
        this.items = res.items || [];
      } catch (e) {
        const msg = String(e);
        this.error = msg ? `仓库列表刷新失败：${msg}` : "仓库列表刷新失败";
      } finally {
        this.loading = false;
      }
    },
    async selectProject(p: { id: string; display: string }) {
      this.selectedRepo = p.id;
      this.selectedProjectName = p.display;
      this.selectedSourceBranch = "";
      this.sourceBranches = [];
      this.targetBranches = [];
      await this.loadAllBranches();
    },
    async loadAllBranches() {
      if (!this.selectedRepo) return;
      this.sourceBranchesLoading = true;
      this.sourceBranchesError = "";
      this.targetBranchesLoading = true;
      this.targetBranchesError = "";
      this.sourceBranches = [];
      this.targetBranches = [];
      try {
        if (isE2E) {
          const core = ["dev", "test", "gray", "main"];
          const extra = Array.from({ length: 900 }, (_, i) => `release/${i}`);
          const list = [...core, ...extra];
          this.sourceBranches = list.slice();
          this.targetBranches = list.slice();
          if (!this.selectedSourceBranch) this.selectedSourceBranch = list[0] || "";
          return;
        }
        const res = await listBranches({ repo: this.selectedRepo });
        const list = res.branches || [];
        this.sourceBranches = list;
        this.targetBranches = list;
      } catch (e) {
        const msg = String(e);
        const friendly = msg ? `分支刷新失败：${msg}` : "分支刷新失败";
        this.sourceBranchesError = friendly;
        this.targetBranchesError = friendly;
      } finally {
        this.sourceBranchesLoading = false;
        this.targetBranchesLoading = false;
      }
    },
  },
});

function isSubsequence(needle: string, haystack: string) {
  if (!needle) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}
