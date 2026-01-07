import { defineStore } from 'pinia'
import { listBranches, listProjects } from '../ipc/bridge'
import type { ListProjectsItem } from '../ipc/types'

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    items: [] as ListProjectsItem[],
    loading: false,
    error: '',

    filter: '',
    page: 1,
    pageSize: 30,

    selectedProjectId: 0,
    selectedProjectName: '',

    sourceBranches: [] as string[],
    sourceBranchesLoading: false,
    sourceBranchesError: '',
    targetBranches: [] as string[],
    targetBranchesLoading: false,
    targetBranchesError: '',
    selectedSourceBranch: '',
  }),
  getters: {
    filteredItems(state) {
      const q = (state.filter || '').trim().toLowerCase()
      if (!q) return state.items
      return state.items.filter((p) => {
        const s = p.search || p.display.toLowerCase()
        if (s.includes(q)) return true
        return isSubsequence(q, s)
      })
    },
    totalPages(state): number {
      const total = (this as any).filteredItems.length as number
      return Math.max(1, Math.ceil(total / state.pageSize))
    },
    pagedItems(state) {
      const list = (this as any).filteredItems as ListProjectsItem[]
      const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize))
      const page = Math.max(1, Math.min(state.page, totalPages))
      const start = (page - 1) * state.pageSize
      const end = start + state.pageSize
      return list.slice(start, end)
    },
  },
  actions: {
    reset() {
      this.items = []
      this.loading = false
      this.error = ''
      this.filter = ''
      this.page = 1
      this.selectedProjectId = 0
      this.selectedProjectName = ''
      this.sourceBranches = []
      this.sourceBranchesLoading = false
      this.sourceBranchesError = ''
      this.targetBranches = []
      this.targetBranchesLoading = false
      this.targetBranchesError = ''
      this.selectedSourceBranch = ''
    },
    setFilter(text: string) {
      this.filter = text
      this.page = 1
    },
    prevPage() {
      if (this.page > 1) this.page -= 1
    },
    nextPage() {
      const totalPages = this.totalPages
      if (this.page < totalPages) this.page += 1
    },
    async loadProjects() {
      this.loading = true
      this.error = ''
      try {
        const res = await listProjects()
        this.items = res.items || []
      } catch (e) {
        const msg = String(e)
        this.error = msg ? `项目列表刷新失败：${msg}` : '项目列表刷新失败'
      } finally {
        this.loading = false
      }
    },
    async selectProject(p: { id: number; display: string }) {
      this.selectedProjectId = p.id
      this.selectedProjectName = p.display
      this.selectedSourceBranch = ''
      this.sourceBranches = []
      this.targetBranches = []
      await this.loadAllBranches()
    },
    async loadAllBranches() {
      if (!this.selectedProjectId) return
      this.sourceBranchesLoading = true
      this.sourceBranchesError = ''
      this.targetBranchesLoading = true
      this.targetBranchesError = ''
      this.sourceBranches = []
      this.targetBranches = []
      try {
        const res = await listBranches({ projectId: this.selectedProjectId })
        const list = res.branches || []
        this.sourceBranches = list
        this.targetBranches = list
      } catch (e) {
        const msg = String(e)
        const friendly = msg ? `分支刷新失败：${msg}` : '分支刷新失败'
        this.sourceBranchesError = friendly
        this.targetBranchesError = friendly
      } finally {
        this.sourceBranchesLoading = false
        this.targetBranchesLoading = false
      }
    },
  },
})

function isSubsequence(needle: string, haystack: string) {
  if (!needle) return true
  let j = 0
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++
  }
  return j === needle.length
}
