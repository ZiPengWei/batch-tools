<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuthStore } from './renderer/store/auth'
import { useProjectsStore } from './renderer/store/projects'
import { useMergeStore } from './renderer/store/merge'
import type { MergeRunSummary } from './renderer/store/merge'

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

const coreTargetOrder = ['dev', 'test', 'gray', 'master'] as const
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
const showFinish = ref(false)
const finishSummary = ref<MergeRunSummary | null>(null)

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
})
</script>

<template>
  <div class="page">
    <div class="container">
      <div class="card">
        <div class="card-title">GitLab 认证</div>
        <div class="row">
          <div class="label">GitLab URL:</div>
          <input v-model="auth.baseUrl" class="input" placeholder="http://..." />
        </div>
        <div class="row">
          <div class="label">Access Token:</div>
          <input v-model="auth.token" class="input" placeholder="glpat-..." type="password" />
        </div>
        <div class="row">
          <label class="checkbox">
            <input v-model="auth.rememberToken" type="checkbox" />
            保存 Token (不安全)
          </label>
        </div>
        <div class="row">
          <button class="btn" :disabled="auth.busy" @click="auth.connect()">
            {{ auth.busy ? '验证中...' : '验证并连接' }}
          </button>
          <div v-if="auth.connected" class="status ok">已连接: {{ auth.userName }} ({{ auth.username }})</div>
          <div v-else class="status muted">未连接</div>
        </div>
        <div v-if="auth.connected && projects.loading" class="muted small">正在刷新项目列表...</div>
        <div v-if="auth.error" class="status err">{{ auth.error }}</div>
      </div>

      <div class="sep" />

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
              <input
                v-model="projects.filter"
                class="input"
                placeholder="过滤项目…"
                :disabled="!canUseContent"
                @input="projects.setFilter(projects.filter)"
              />
            </div>

            <div class="list">
              <button
                v-for="p in projects.pagedItems"
                :key="p.id"
                class="list-item"
                :class="{ active: p.id === projects.selectedProjectId }"
                :disabled="!canUseContent"
                @click="projects.selectProject({ id: p.id, display: p.display })"
              >
                {{ p.display }}
              </button>
              <div v-if="projects.loading" class="muted small">加载中...</div>
              <div v-else-if="projects.error" class="err small">{{ projects.error }}</div>
              <div v-else-if="!projects.items.length" class="muted small">{{ canUseContent ? '无数据' : '请先连接 GitLab' }}</div>
            </div>

            <div class="row paging">
              <button class="btn ghost" :disabled="projects.page <= 1" @click="projects.prevPage()">上一页</button>
              <button class="btn ghost" :disabled="projects.page >= projects.totalPages" @click="projects.nextPage()">
                下一页
              </button>
              <div class="muted small">第 {{ projects.page }}/{{ projects.totalPages }} 页</div>
            </div>

            <div class="muted small">已选: {{ projects.selectedProjectName || '(无)' }}</div>
          </div>

          <div class="card col branch-col">
            <div class="row space-between">
              <div class="card-title">2. 选择源分支</div>
              <button class="btn" :disabled="!projects.selectedProjectId || projects.sourceBranchesLoading" @click="projects.loadAllBranches()">
                {{ projects.sourceBranchesLoading ? '加载中...' : '刷新分支' }}
              </button>
            </div>
            <div class="row">
              <input
                v-model="sourceFilter"
                class="input"
                placeholder="过滤源分支..."
                :disabled="!projects.selectedProjectId || projects.sourceBranchesLoading"
              />
            </div>
            <div class="tags branch-list">
              <button
                v-for="b in displaySourceBranches"
                :key="b"
                :title="b"
                class="tag"
                :class="{ active: b === projects.selectedSourceBranch }"
                :disabled="!projects.selectedProjectId || projects.sourceBranchesLoading"
                @click="projects.selectedSourceBranch = projects.selectedSourceBranch === b ? '' : b"
              >
                {{ b }}
              </button>
              <div v-if="projects.sourceBranchesLoading" class="muted small">加载中...</div>
              <div v-else-if="projects.sourceBranchesError" class="err small">{{ projects.sourceBranchesError }}</div>
              <div v-else-if="projects.selectedProjectId && !projects.sourceBranches.length" class="muted small">无数据</div>
              <div v-else-if="!projects.selectedProjectId" class="muted small">请选择项目</div>
            </div>
          </div>

          <div class="card col branch-col">
            <div class="row space-between">
              <div class="card-title">3. 选择目标分支</div>
              <button
                class="btn"
                :disabled="merge.running || !projects.selectedProjectId || !projects.selectedSourceBranch || !merge.selectedTargets.length"
                @click="onClickBatch"
              >
                {{ merge.running ? '处理中...' : mergeButtonText }}
              </button>
            </div>
            <div class="row">
              <input v-model="merge.targetFilter" class="input" placeholder="过滤目标分支..." />
            </div>
            <div class="tags branch-list">
              <template v-for="(row, idx) in displayTargetRows" :key="row.type === 'separator' ? `sep-${idx}` : row.name">
                <div v-if="row.type === 'separator'" class="branch-sep" />
                <button
                  v-else
                  class="tag"
                  :class="{ active: merge.selectedTargets.includes(row.name), core: row.isCore }"
                  :disabled="!projects.selectedProjectId"
                  :title="row.name"
                  @click="merge.toggleTarget(row.name)"
                >
                  <span v-if="row.isCore" class="core-mark">★</span>
                  <span class="branch-name">{{ row.name }}</span>
                </button>
              </template>
              <div v-if="projects.targetBranchesLoading" class="muted small">加载中...</div>
              <div v-else-if="projects.targetBranchesError" class="err small">{{ projects.targetBranchesError }}</div>
              <div
                v-else-if="
                  projects.selectedProjectId &&
                  merge.targets.length &&
                  !displayTargetRows.length &&
                  !projects.targetBranchesLoading &&
                  !projects.targetBranchesError
                "
                class="muted small"
              >
                无匹配
              </div>
              <div v-else-if="projects.selectedProjectId && !merge.targets.length" class="muted small">无数据</div>
              <div v-else-if="!projects.selectedProjectId" class="muted small">请选择项目</div>
            </div>
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
        <div v-if="confirmRunning" class="dialog-text">
          <div class="muted small">操作日志</div>
          <div ref="confirmLogEl" class="log">
            <div v-for="(l, idx) in merge.logLines" :key="idx" class="log-line" :class="{ err: l.error }">
              {{ l.text }}
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
            <div v-if="finishSummary.mergedCount && finishSummary.noopCount">已跳过无变更: {{ finishSummary.noopCount }} 项</div>
          </template>
          <template v-else>
            <div v-if="finishSummary">冲突/失败: {{ finishSummary.conflictsCount }} 项</div>
            <div v-if="finishSummary?.rolledBack">已回滚本次创建的 MR</div>
            <div v-if="finishSummary?.message" class="small muted">{{ finishSummary.message }}</div>
          </template>
        </div>
        <div class="dialog-text">
          <div class="muted small">操作日志</div>
          <div class="log">
            <div v-for="(l, idx) in merge.logLines" :key="idx" class="log-line" :class="{ err: l.error }">
              {{ l.text }}
            </div>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn" @click="showFinish = false">我知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  background: #f5f5f5;
  color: #222;
}

.container {
  width: fit-content;
  max-width: min(1200px, calc(100vw - 32px));
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sep {
  height: 1px;
  background: #d9d9d9;
}

.content.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.card {
  background: #fff;
  border: 1px solid #d9d9d9;
  border-radius: 10px;
  padding: 14px;
}

.card-title {
  font-weight: 700;
  margin-bottom: 10px;
}

.columns {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: stretch;
}

.project-col {
  width: 250px;
}

.branch-col {
  flex: 1 1 0;
  min-width: 320px;
}

@media (max-width: 980px) {
  .container {
    width: 100%;
  }

  .project-col,
  .branch-col {
    flex: 1 1 100%;
    min-width: 0;
  }
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.row.space-between {
  justify-content: space-between;
  flex-wrap: nowrap;
}

.row.space-between .card-title {
  margin-bottom: 0;
}

.label {
  width: 110px;
  color: #444;
}

.input {
  flex: 1;
  min-width: 220px;
  border: 1px solid #cfcfcf;
  border-radius: 8px;
  padding: 8px 10px;
  outline: none;
}

.btn {
  border: 0;
  border-radius: 8px;
  background: #1890ff;
  color: #fff;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}

.btn:hover {
  background: #1681e5;
  transform: translateY(-1px);
}

.btn:active {
  transform: translateY(0);
}

.btn:disabled {
  background: #d9d9d9;
  color: #666;
  cursor: not-allowed;
  transform: none;
}

.btn.ghost {
  background: transparent;
  border: 1px solid #cfcfcf;
  color: #333;
}

.checkbox {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #333;
}

.status {
  margin-left: 8px;
}

.status.ok {
  color: #1a7f37;
}

.status.err {
  color: #d12a2a;
}

.status.muted {
  color: #666;
}

.small {
  font-size: 12px;
}

.muted {
  color: #666;
}

.err {
  color: #d12a2a;
}

.list {
  border: 1px solid #e6e6e6;
  border-radius: 10px;
  padding: 8px;
  height: 370px;
  overflow: auto;
}

.list-item {
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 8px;
  padding: 8px 10px;
  background: transparent;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.list-item:hover {
  background: #f5f5f5;
}

.list-item.active {
  background: rgba(24, 144, 255, 0.12);
}

.list-item:disabled {
  cursor: not-allowed;
}

.paging {
  margin-top: 10px;
  justify-content: space-between;
}

.tags {
  display: flex;
  flex-wrap: nowrap;
  flex-direction: column;
  gap: 8px;
  height: 470px;
  overflow: auto;
  align-content: normal;
}

.branch-list > .muted,
.branch-list > .err {
  padding: 6px 0;
}

.tag {
  border: 1px solid #cfcfcf;
  border-radius: 999px;
  padding: 5px 12px;
  background: #fff;
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.tag:hover {
  background: #f7fbff;
}

.tag.active {
  border-color: #1890ff;
  background: rgba(24, 144, 255, 0.12);
}

.tag.core {
  border-color: #ffd666;
  background: rgba(255, 214, 102, 0.18);
}

.tag.core.active {
  border-color: #1890ff;
  background: rgba(24, 144, 255, 0.12);
  box-shadow: 0 0 0 2px rgba(255, 214, 102, 0.35) inset;
}

.core-mark {
  color: #d48806;
  margin-right: 6px;
  flex: 0 0 auto;
}

.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-sep {
  height: 1px;
  background: #e6e6e6;
  margin: 4px 0;
  width: 100%;
  flex: 0 0 auto;
}

.log {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  border: 1px solid #e6e6e6;
  border-radius: 10px;
  padding: 10px;
  max-height: min(360px, 28vh);
  overflow: auto;
  background: #fafafa;
}

.log-line {
  padding: 2px 0;
}

.log-line.err {
  color: #d12a2a;
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.dialog {
  width: fit-content;
  max-width: min(980px, calc(100vw - 32px));
  min-width: min(520px, calc(100vw - 32px));
  background: #fff;
  border-radius: 12px;
  border: 1px solid #d9d9d9;
  padding: 14px;
  animation: pop 160ms ease-out;
}

.dialog-title {
  font-weight: 800;
  margin-bottom: 8px;
}

.dialog-text {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@keyframes pop {
  from {
    transform: translateY(6px) scale(0.98);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}
</style>
