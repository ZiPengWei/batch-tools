<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuthStore } from './renderer/store/auth'
import { useProjectsStore } from './renderer/store/projects'
import { useMergeStore } from './renderer/store/merge'
import type { MergeRunSummary } from './renderer/store/merge'
import ConflictDialog from './renderer/components/ConflictDialog.vue'
import { onMergeConflict, openExternal } from './renderer/ipc/bridge'

const auth = useAuthStore()
const projects = useProjectsStore()
const merge = useMergeStore()

const canUseContent = computed(() => auth.connected)

const sourceBranch = computed(() => projects.selectedSourceBranch)
const selectedTargets = computed(() => merge.selectedTargets)

const sourceFilter = ref('')

function isSubsequence(needle: string, haystack: string) {
  if (!needle) return true
  let j = 0
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++
  }
  return j === needle.length
}

function matchesBranch(query: string, branch: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const s = branch.toLowerCase()
  if (s.includes(q)) return true
  return isSubsequence(q, s)
}

const displaySourceBranches = computed(() => {
  const list = projects.sourceBranches || []
  return list.filter((b) => matchesBranch(sourceFilter.value, b))
})

type TargetRow = { type: 'branch'; name: string; isCore: boolean } | { type: 'separator' }

const coreTargetOrder = ['dev', 'test', 'gray'] as const
const coreTargetSet = new Set<string>(coreTargetOrder)

const displayTargetRows = computed<TargetRow[]>(() => {
  const list = merge.targets || []
  const q = (merge.targetFilter || '').trim()
  const visible = q ? list.filter((b) => matchesBranch(q, b)) : list.slice()

  if (q) {
    for (const b of merge.selectedTargets) {
      if (!visible.includes(b)) visible.unshift(b)
    }
  }

  const lowerToName = new Map<string, string>()
  for (const b of visible) {
    const k = b.toLowerCase()
    if (!lowerToName.has(k)) lowerToName.set(k, b)
  }

  const core: string[] = []
  for (const n of coreTargetOrder) {
    const v = lowerToName.get(n)
    if (v) core.push(v)
  }

  const others: string[] = []
  for (const [k, v] of lowerToName) {
    if (coreTargetSet.has(k)) continue
    others.push(v)
  }
  others.sort((a, b) => {
    const la = a.toLowerCase()
    const lb = b.toLowerCase()
    const r = la.localeCompare(lb)
    return r || a.localeCompare(b)
  })

  const rows: TargetRow[] = []
  rows.push(...core.map((name) => ({ type: 'branch' as const, name, isCore: true })))
  if (core.length && others.length) rows.push({ type: 'separator' })
  rows.push(...others.map((name) => ({ type: 'branch' as const, name, isCore: false })))
  return rows
})

const mergeButtonText = computed(() => {
  const sc = sourceBranch.value ? 1 : 0
  const tc = selectedTargets.value.length
  if (sc > 0 && tc > 0) return `开始批量合并 (${sc} 源分支, ${tc} 目标分支)`
  if (sc > 0) return `开始批量合并 (${sc} 源分支)`
  return '开始批量合并'
})

const showConfirm = ref(false)
const confirmRunning = ref(false)
const confirmLogEl = ref<HTMLDivElement | null>(null)
const isAuthExpanded = ref(true)

watch(
  () => auth.connected,
  (val) => {
    isAuthExpanded.value = !val
  },
  { immediate: true }
)

const showFinish = ref(false)
const finishSummary = ref<MergeRunSummary | null>(null)

const conflictVisible = ref(false)
const conflictData = ref<any>(null)
const conflictMrWebUrl = computed(() => conflictData.value?.mrWebUrl || '')

const ipcAvailable = computed(() => {
  const ipc = (window as any)?.ipcRenderer
  return Boolean(ipc?.on && ipc?.invoke)
})

const confirmLogHint = computed(() => {
  if (!confirmRunning.value) return ''
  if (merge.logLines.length) return ''
  if (!ipcAvailable.value) return '无法接收日志：ipcRenderer 不可用，请确认在 Electron 环境运行。'
  return '暂无日志输出，正在等待后台任务输出...'
})

function openConflictMr() {
  const url = conflictMrWebUrl.value
  if (!url) return
  openExternal(url)
}

const finishTitle = computed(() => {
  const s = finishSummary.value
  if (!s) return '合并结果'
  if (s.ok) {
    if (s.mergedCount === 0 && s.noopCount > 0) return '合并完成（无变更）'
    return '合并完成'
  }
  return '合并失败'
})

function onClickBatch() {
  if (!projects.selectedProjectId) return
  if (!projects.selectedSourceBranch) return
  if (!merge.selectedTargets.length) return
  confirmRunning.value = false
  showConfirm.value = true
}

async function confirmRun() {
  confirmRunning.value = true
  await nextTick()
  finishSummary.value = await merge.run(projects.selectedProjectId, [projects.selectedSourceBranch])
  confirmRunning.value = false
  showConfirm.value = false
  showFinish.value = true
}

watch(
  () => merge.logLines.length,
  async () => {
    if (!confirmRunning.value) return
    await nextTick()
    const el = confirmLogEl.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  },
)

watch(
  () => projects.targetBranches,
  (b) => {
    merge.setTargets(b)
  },
  { deep: true },
)

onMounted(() => {
  auth.loadLocal()

  onMergeConflict((data) => {
    conflictData.value = data
    conflictVisible.value = true
  })
})
</script>

<template>
  <div class="page">
    <div class="container">
      <div class="card auth-card">
        <div class="row space-between" style="margin-bottom: 0">
          <div class="card-title">
            GitLab 认证
            <div v-if="auth.connected" class="status-badge ok">
              <span class="dot"></span> 已连接: {{ auth.userName }}
            </div>
            <div v-else class="status-badge muted">
              <span class="dot"></span> 未连接
            </div>
          </div>
          <button class="btn ghost small" @click="isAuthExpanded = !isAuthExpanded">
            {{ isAuthExpanded ? '收起' : '配置' }}
          </button>
        </div>

        <div v-show="isAuthExpanded" class="auth-body">
          <div class="auth-grid">
            <div class="input-group">
              <div class="label">GitLab URL</div>
              <input v-model="auth.baseUrl" class="input" placeholder="http://..." />
            </div>
            <div class="input-group">
              <div class="label">Access Token</div>
              <input v-model="auth.token" class="input" placeholder="glpat-..." type="password" />
            </div>
            <div class="actions">
              <button class="btn" :disabled="auth.busy" @click="auth.connect()">
                {{ auth.busy ? '验证中...' : '验证并连接' }}
              </button>
              <label class="checkbox small">
                <input v-model="auth.rememberToken" type="checkbox" />
                保存
              </label>
            </div>
          </div>
          <div v-if="auth.connected && projects.loading" class="muted small" style="margin-top: 8px">正在刷新项目列表...</div>
          <div v-if="auth.error" class="status err" style="margin-top: 8px">{{ auth.error }}</div>
        </div>
      </div>

      <div class="content" :class="{ disabled: !canUseContent }">
        <div class="columns">
          <div class="card col project-col">
            <div class="row space-between">
              <div class="card-title">1. 选择项目</div>
              <button class="btn" :disabled="!canUseContent || projects.loading" @click="projects.loadProjects()">
                {{ projects.loading ? '加载中...' : '刷新项目' }}
              </button>
            </div>
            <div class="row">
              <input v-model="projects.filter" class="input" placeholder="过滤项目…" :disabled="!canUseContent"
                @input="projects.setFilter(projects.filter)" />
            </div>

            <div class="list selector-box">
              <button v-for="p in projects.filteredItems" :key="p.id" class="list-item"
                :class="{ active: p.id === projects.selectedProjectId }" :disabled="!canUseContent"
                @click="projects.selectProject({ id: p.id, display: p.display })">
                {{ p.display }}
              </button>
              <div v-if="projects.loading" class="muted small">加载中...</div>
              <div v-else-if="projects.error" class="err small">{{ projects.error }}</div>
              <div v-else-if="!projects.items.length" class="selector-empty">暂无数据</div>
            </div>

            <div class="muted small">已选: {{ projects.selectedProjectName || '(无)' }}</div>
          </div>

          <div class="card col branch-col">
            <div class="row space-between">
              <div class="card-title">2. 选择源分支</div>
              <button class="btn" :disabled="!projects.selectedProjectId || projects.sourceBranchesLoading"
                @click="projects.loadAllBranches()">
                {{ projects.sourceBranchesLoading ? '加载中...' : '刷新分支' }}
              </button>
            </div>
            <div class="row">
              <input v-model="sourceFilter" class="input" placeholder="过滤源分支..."
                :disabled="!projects.selectedProjectId || projects.sourceBranchesLoading" />
            </div>
            <div class="tags branch-list selector-box">
              <button v-for="b in displaySourceBranches" :key="b" :title="b" class="tag"
                :class="{ active: b === projects.selectedSourceBranch }"
                :disabled="!projects.selectedProjectId || projects.sourceBranchesLoading"
                @click="projects.selectedSourceBranch = projects.selectedSourceBranch === b ? '' : b">
                <span class="branch-name">{{ b }}</span>
              </button>
              <div v-if="projects.sourceBranchesLoading" class="muted small">加载中...</div>
              <div v-else-if="projects.sourceBranchesError" class="err small">{{ projects.sourceBranchesError }}</div>
              <div v-else-if="!projects.selectedProjectId || !displaySourceBranches.length" class="selector-empty">
                暂无数据
              </div>
            </div>
            <div class="muted small">共 {{ displaySourceBranches.length }} 个分支</div>
          </div>

          <div class="card col branch-col">
            <div class="row space-between">
              <div class="card-title">3. 选择目标分支</div>
              <button class="btn"
                :disabled="merge.running || !projects.selectedProjectId || !projects.selectedSourceBranch || !merge.selectedTargets.length"
                @click="onClickBatch">
                {{ merge.running ? '处理中...' : mergeButtonText }}
              </button>
            </div>
            <div class="row">
              <input v-model="merge.targetFilter" class="input" placeholder="过滤目标分支..." />
            </div>
            <div class="tags branch-list selector-box">
              <template v-for="(row, idx) in displayTargetRows"
                :key="row.type === 'separator' ? `sep-${idx}` : row.name">
                <div v-if="row.type === 'separator'" class="branch-sep" />
                <button v-else class="tag"
                  :class="{ active: merge.selectedTargets.includes(row.name), core: row.isCore }"
                  :disabled="!projects.selectedProjectId" :title="row.name" @click="merge.toggleTarget(row.name)">
                  <span v-if="row.isCore" class="core-mark">★</span>
                  <span class="branch-name">{{ row.name }}</span>
                </button>
              </template>
              <div v-if="projects.targetBranchesLoading" class="muted small">加载中...</div>
              <div v-else-if="projects.targetBranchesError" class="err small">{{ projects.targetBranchesError }}</div>
              <div v-else-if="
                projects.selectedProjectId &&
                merge.targets.length &&
                !displayTargetRows.length &&
                !projects.targetBranchesLoading &&
                !projects.targetBranchesError
              " class="muted small">
                无匹配
              </div>
              <div v-else-if="!projects.selectedProjectId || !merge.targets.length" class="selector-empty">暂无数据</div>
            </div>
            <div class="muted small">共 {{displayTargetRows.filter((r) => r.type === 'branch').length}} 个分支</div>
          </div>
        </div>

      </div>
    </div>

    <div v-if="showConfirm" class="modal">
      <div class="dialog">
        <div class="dialog-title">{{ confirmRunning ? '正在合并...' : '确认合并' }}</div>
        <div class="dialog-text">
          <div>源分支: 1 个</div>
          <div>目标分支: {{ merge.selectedTargets.length }} 个</div>
          <div>总计创建 MR: {{ merge.selectedTargets.length }} 个</div>
          <div class="small muted">
            注意：先创建 MR 并检测是否可合并；若检测到冲突/无法确认，将回滚（删除/关闭）本次创建的 MR。
          </div>
        </div>
        <div v-if="confirmRunning" class="dialog-text log-wrapper">
          <div v-if="conflictVisible" class="small muted"
            style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
            <span>冲突处理中：已弹出冲突解决窗口，请完成处理后继续。</span>
            <button v-if="conflictMrWebUrl" class="btn ghost" @click="openConflictMr">打开 MR</button>
          </div>
          <div class="muted small">操作日志</div>
          <div ref="confirmLogEl" class="log">
            <div v-if="confirmLogHint" class="log-line muted">{{ confirmLogHint }}</div>
            <div v-for="(l, idx) in merge.logLines" :key="idx" class="log-line" :class="{ err: l.error }">{{ l.text }}
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <template v-if="!confirmRunning">
            <button class="btn ghost" @click="showConfirm = false">取消</button>
            <button class="btn" @click="confirmRun">确认</button>
          </template>
          <template v-else>
            <button class="btn" disabled>合并中...</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="showFinish" class="modal">
      <div class="dialog">
        <div class="dialog-title">{{ finishTitle }}</div>
        <div class="dialog-text">
          <template v-if="finishSummary?.ok">
            <template v-if="finishSummary.mergedCount">
              <div>成功 MR: {{ finishSummary.mergedCount }} 个</div>
            </template>
            <template v-else-if="finishSummary.noopCount">
              <div>本次无变更，已跳过: {{ finishSummary.noopCount }} 项</div>
            </template>
            <div v-else>成功 MR: 0 个</div>
            <div v-if="finishSummary.mergedCount && finishSummary.noopCount">已跳过无变更: {{ finishSummary.noopCount }} 项
            </div>
          </template>
          <template v-else>
            <div v-if="finishSummary">冲突/失败: {{ finishSummary.conflictsCount }} 项</div>
            <div v-if="finishSummary?.rolledBack">已回滚本次创建的 MR</div>
            <div v-if="finishSummary?.message" class="small muted">{{ finishSummary.message }}</div>
          </template>
        </div>
        <div class="dialog-text log-wrapper">
          <div class="muted small">操作日志</div>
          <div class="log">
            <div v-for="(l, idx) in merge.logLines" :key="idx" class="log-line" :class="{ err: l.error }">{{ l.text }}
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn" @click="showFinish = false">我知道了</button>
        </div>
      </div>
    </div>

    <ConflictDialog :visible="conflictVisible" :conflict-data="conflictData" @close="conflictVisible = false" />
  </div>
</template>

<style scoped lang="scss">
// =========================================================================================
// Variables & Theme
// =========================================================================================
$primary-color: #0969da;
$primary-hover: #0550ae;
$primary-active: #0a448d;

$success-color: #1a7f37;
$error-color: #cf222e;
$warning-bg: rgba(255, 214, 102, 0.2);
$warning-border: #ffd666;
$warning-text: #9a6700;

$bg-page: #f6f8fa;
$bg-card: #ffffff;
$bg-input: #ffffff;
$bg-hover: #f3f4f6;

$border-color: #d0d7de;
$border-radius: 6px;
$border-radius-lg: 12px;

$text-primary: #1f2328;
$text-secondary: #656d76;
$text-placeholder: #8c959f;

$shadow-sm: 0 1px 0 rgba(27, 31, 36, 0.04);
$shadow-md: 0 3px 6px rgba(140, 149, 159, 0.15);
$shadow-modal: 0 8px 24px rgba(140, 149, 159, 0.2);

$transition-base: all 0.2s cubic-bezier(0.3, 0, 0.5, 1);

// =========================================================================================
// Global Layout & Reset
// =========================================================================================
*,
*::before,
*::after {
  box-sizing: border-box;
}

.page {
  background: $bg-page;
  color: $text-primary;
  width: 100%;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex;
  flex-direction: column;
}

.container {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-sizing: border-box;
  overflow: hidden;
  max-width: 1600px; // Limit max width on very large screens for better readability
  margin: 0 auto;
}

// =========================================================================================
// Components: Card
// =========================================================================================
.card {
  background: $bg-card;
  border: 1px solid $border-color;
  border-radius: $border-radius;
  padding: 20px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: $shadow-sm;

  .card-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: $text-primary;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.auth-card {
  flex: 0 0 auto;
  transition: all 0.3s ease;

  .auth-body {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid $border-color;
    animation: slide-down 0.2s ease-out;
  }

  .auth-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    align-items: end;

    .input-group {
      min-width: 0; // Allow grid item to shrink below content size if needed
      display: flex;
      flex-direction: column;
      gap: 6px;

      .label {
        font-size: 12px;
        color: $text-secondary;
      }
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 32px; // Match input height roughly
    }
  }
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  margin-left: 12px;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  &.ok {
    background: rgba($success-color, 0.1);
    color: $success-color;
  }

  &.muted {
    background: rgba($text-secondary, 0.1);
    color: $text-secondary;
  }
}

@keyframes slide-down {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// =========================================================================================
// Components: Layout Rows & Columns
// =========================================================================================
.columns {
  display: flex;
  flex-wrap: nowrap;
  gap: 20px;
  align-items: stretch;
  min-height: 0;
  justify-content: space-between;
  flex: 1 1 auto;
}

.project-col {
  width: 260px;
  flex: 0 0 260px;
}

.branch-col {
  flex: 1 1 0;
  min-width: 280px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  flex: 0 0 auto;

  &.space-between {
    justify-content: space-between;
    flex-wrap: nowrap;
    margin-bottom: 12px;

    .card-title {
      margin-bottom: 0;
    }
  }
}

// =========================================================================================
// Components: Form Elements
// =========================================================================================
.label {
  width: 100px;
  font-size: 14px;
  color: $text-secondary;
  font-weight: 500;
}

.input {
  flex: 1;
  width: 100%;
  border: 1px solid $border-color;
  border-radius: $border-radius;
  padding: 8px 12px;
  outline: none;
  font-size: 14px;
  color: $text-primary;
  background: $bg-input;
  transition: $transition-base;

  &::placeholder {
    color: $text-placeholder;
  }

  &:focus {
    border-color: $primary-color;
    box-shadow: 0 0 0 3px rgba($primary-color, 0.15);
  }

  &:disabled {
    background: #f6f8fa;
    color: $text-placeholder;
    cursor: not-allowed;
  }
}

.checkbox {
  display: flex;
  gap: 8px;
  align-items: center;
  color: $text-primary;
  font-size: 14px;
  cursor: pointer;
  user-select: none;

  input[type="checkbox"] {
    accent-color: $primary-color;
    width: 16px;
    height: 16px;
  }
}

// =========================================================================================
// Components: Buttons
// =========================================================================================
.btn {
  border: 1px solid transparent;
  border-radius: $border-radius;
  background: $primary-color;
  color: #ffffff;
  font-weight: 600;
  font-size: 14px;
  padding: 6px 16px;
  cursor: pointer;
  transition: $transition-base;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: $shadow-sm;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: $primary-hover;
    transform: translateY(-1px);
    box-shadow: $shadow-md;
  }

  &:active:not(:disabled) {
    background: $primary-active;
    transform: translateY(0);
    box-shadow: none;
  }

  &:disabled {
    background: #f0f2f4;
    color: #8c959f;
    border-color: rgba(27, 31, 36, 0.15);
    cursor: not-allowed;
    box-shadow: none;
  }

  &.ghost {
    background: transparent;
    border: 1px solid $border-color;
    color: $text-primary;
    box-shadow: $shadow-sm;

    &:hover:not(:disabled) {
      background: #f3f4f6;
      border-color: #8c959f;
    }
  }
}

// =========================================================================================
// Components: Lists & Selectors
// =========================================================================================
.selector-box {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid $border-color;
  border-radius: $border-radius;
  background: #ffffff;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  // Custom Scrollbar
  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #d0d7de;
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: #afb8c1;
  }
}

.selector-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $text-placeholder;
  font-size: 14px;
  font-style: italic;
}

// List Items (Project List)
.list-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: $border-radius;
  padding: 8px 12px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: $text-primary;
  transition: $transition-base;
  line-height: 1.4;

  &:hover:not(:disabled) {
    background: $bg-hover;
  }

  &.active {
    background: rgba($primary-color, 0.1);
    color: $primary-color;
    font-weight: 600;
    border-color: rgba($primary-color, 0.2);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

// Tags (Branches)
.tags {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tag {
  border: 1px solid $border-color;
  border-radius: 6px; // Slightly less rounded than pills for a cleaner list look
  padding: 6px 12px;
  background: #fff;
  cursor: pointer;
  transition: $transition-base;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 36px;
  font-size: 13px;
  color: $text-primary;
  position: relative;

  &:hover:not(:disabled) {
    background: $bg-hover;
    border-color: #8c959f;
  }

  &.active {
    border-color: $primary-color;
    background: rgba($primary-color, 0.08);
    color: $primary-color;
    font-weight: 500;

    // Add a left accent bar for active state
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: $primary-color;
      border-top-left-radius: 5px;
      border-bottom-left-radius: 5px;
    }
  }

  &.core {
    background: #fff8c5;
    border-color: rgba(212, 167, 44, 0.4);

    &:hover:not(:disabled) {
      background: #fbf0b5;
    }
  }

  &.core.active {
    background: rgba($primary-color, 0.1);
    border-color: $primary-color;
    color: $primary-color;

    &::before {
      background: $primary-color;
    }

    .core-mark {
      color: #d48806;
    }
  }

  .core-mark {
    color: #d48806;
    margin-right: 8px;
    font-size: 14px;
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
}

.branch-sep {
  height: 1px;
  background: $border-color;
  margin: 8px 0;
  width: 100%;
}

// =========================================================================================
// Components: Modal & Dialog
// =========================================================================================
.modal {
  position: fixed;
  inset: 0;
  background: rgba(31, 35, 40, 0.6); // Darker backdrop
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 1000;
}

.dialog {
  width: 90%;
  max-width: 800px;
  min-width: 320px;
  background: $bg-card;
  border-radius: $border-radius-lg;
  box-shadow: $shadow-modal;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: modal-pop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: 90vh;
  overflow: hidden;

  .dialog-title {
    font-size: 18px;
    font-weight: 600;
    color: $text-primary;
    margin: 0;
    flex: 0 0 auto;
  }

  .dialog-text {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
    color: $text-primary;
    line-height: 1.5;
    flex: 0 0 auto;
    min-height: 0;

    &.log-wrapper {
      flex: 1 1 auto;
      overflow: hidden;
    }
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 8px;
    flex: 0 0 auto;
  }
}

// Logs area
.log {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid $border-color;
  border-radius: $border-radius;
  padding: 12px;
  flex: 1;
  height: auto;
  min-height: 150px;
  overflow-y: auto;
  background: #f6f8fa;
  color: $text-primary;

  .log-line {
    word-break: break-all;
    white-space: pre-wrap;

    &.err {
      color: $error-color;
      background: #ffebe9;
      margin: 0 -12px;
      padding: 0 12px;
    }
  }
}

// =========================================================================================
// Utilities & States
// =========================================================================================
.content.disabled {
  opacity: 0.6;
  pointer-events: none;
  filter: grayscale(10%);
}

.content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.status {
  font-size: 13px;
  display: flex;
  align-items: center;

  &.ok {
    color: $success-color;
  }

  &.err {
    color: $error-color;
  }

  &.muted {
    color: $text-secondary;
  }
}

.small {
  font-size: 12px;
}

.muted {
  color: $text-secondary;
}

.err {
  color: $error-color;
}

@keyframes modal-pop {
  from {
    transform: scale(0.96);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
