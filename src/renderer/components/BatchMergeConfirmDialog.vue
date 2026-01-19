<template>
  <n-modal
    :closable="!disableCloseWhenRunning || !confirmRunning"
    :mask-closable="!disableCloseWhenRunning || !confirmRunning"
    preset="dialog"
    :show="show"
    :style="modalStyle"
    :title="confirmRunning ? runningTitle : confirmTitle"
    @update:show="setShow"
  >
    <n-space vertical>
      <n-text>源分支: {{ sourceBranches.length }} 个</n-text>
      <n-text>目标分支: {{ targetCount }} 个</n-text>
      <n-text>总计创建 MR: {{ targetCount }} 个</n-text>
      <n-alert
        :show-icon="true"
        type="warning"
      >
        {{ warningText }}
      </n-alert>

      <n-collapse-transition :show="confirmRunning">
        <div
          v-if="confirmRunning"
          ref="confirmLogEl"
          class="log-wrapper"
          data-testid="confirm-log-wrapper"
        >
          <div
            v-if="conflictActive"
            class="conflict-bar"
          >
            <n-text type="warning">
              冲突处理中：已弹出冲突解决窗口，请完成处理后继续。
            </n-text>
            <n-button
              v-if="conflictMrWebUrl"
              @click="emitOpenConflictMr"
            >
              打开 MR
            </n-button>
          </div>
          <div
            v-if="confirmLogHint"
            class="hint"
          >
            <n-text depth="3">
              {{ confirmLogHint }}
            </n-text>
          </div>
          <n-log
            :log="logLines.join('\n')"
            :rows="10"
            :style="logBoxStyle"
          />
        </div>
      </n-collapse-transition>
    </n-space>
    <template #action>
      <n-button
        v-if="!confirmRunning"
        @click="close"
      >
        取消
      </n-button>
      <n-button
        v-if="!confirmRunning"
        type="primary"
        @click="confirmRun"
      >
        确认
      </n-button>
      <n-button
        v-else
        disabled
        loading
      >
        合并中...
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * BatchMergeConfirmDialog
 * 用途：批量合并前的确认弹窗，合并过程中展示日志并自动滚动到底部。
 *
 * Props：
 * - show: 是否显示弹窗（v-model:show）
 * - projectId: 当前项目 ID
 * - sourceBranches: 源分支列表
 * - targetCount: 目标分支数量（用于展示文案）
 * - logLines: 日志文本行数组
 * - run: 触发合并的异步函数，返回合并摘要或 null
 * - conflictActive/conflictMrWebUrl: 冲突处理中提示与 MR 链接
 * - disableCloseWhenRunning: 运行中是否禁止关闭
 * - modalWidth/confirmTitle/runningTitle/warningText: 文案与样式可配置项
 *
 * Emits：
 * - update:show: (val: boolean) 控制弹窗显示
 * - run-start/run-finish: 合并开始与结束（附 summary）
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { MergeRunSummary } from '../store/merge'
import { openExternal } from '../ipc/bridge'
import {
  NAlert,
  NButton,
  NCollapseTransition,
  NLog,
  NModal,
  NSpace,
  NText,
  useThemeVars,
} from '../ui/naive'

export type BatchMergeConfirmDialogExposed = {
  confirmRun: () => Promise<void>
  stopRunning: () => void
}

const props = withDefaults(
  defineProps<{
    show: boolean
    projectId: number | null | undefined
    sourceBranches: string[]
    targetCount: number
    logLines: string[]
    run: (projectId: number, sourceBranches: string[]) => Promise<MergeRunSummary | null>
    conflictActive?: boolean
    conflictMrWebUrl?: string
    disableCloseWhenRunning?: boolean
    modalWidth?: string
    confirmTitle?: string
    runningTitle?: string
    warningText?: string
  }>(),
  {
    conflictActive: false,
    conflictMrWebUrl: '',
    disableCloseWhenRunning: true,
    modalWidth: 'min(600px, 92vw)',
    confirmTitle: '确认合并',
    runningTitle: '正在合并...',
    warningText:
      '注意：先创建 MR 并检测是否可合并；若检测到冲突/无法确认，将回滚（删除/关闭）本次创建的 MR。',
  },
)

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void
  (e: 'run-start'): void
  (e: 'run-finish', summary: MergeRunSummary | null): void
}>()

const confirmRunning = ref(false)
const confirmLogEl = ref<HTMLDivElement | null>(null)

const themeVars = useThemeVars()

const modalStyle = computed(() => ({
  width: props.modalWidth,
}))

const logBoxStyle = computed(() => {
  const v = themeVars.value
  return {
    border: `1px solid ${v.borderColor}`,
    borderRadius: v.borderRadiusSmall,
    padding: '8px',
  } as const
})

const ipcAvailable = computed(() => {
  const ipc = (window as any)?.ipcRenderer
  return Boolean(ipc?.on && ipc?.invoke)
})

const confirmLogHint = computed(() => {
  if (!confirmRunning.value) return ''
  if (props.logLines.length) return ''
  if (!ipcAvailable.value) return '无法接收日志：ipcRenderer 不可用，请确认在 Electron 环境运行。'
  return '暂无日志输出，正在等待后台任务输出...'
})

function setShow(val: boolean) {
  emit('update:show', val)
}

function close() {
  setShow(false)
}

function stopRunning() {
  confirmRunning.value = false
}

function emitOpenConflictMr() {
  const url = props.conflictMrWebUrl || ''
  if (!url) return
  openExternal(url)
}

async function confirmRun() {
  const projectId = props.projectId
  if (projectId == null) return
  if (!props.sourceBranches.length) return

  confirmRunning.value = true
  emit('run-start')
  await nextTick()

  const summary = await props.run(projectId, props.sourceBranches)
  emit('run-finish', summary)

  confirmRunning.value = false
  setShow(false)
}

watch(
  () => props.show,
  (val) => {
    if (!val) confirmRunning.value = false
  },
)

watch(
  () => props.logLines.length,
  async () => {
    if (!confirmRunning.value) return
    await nextTick()
    const el = confirmLogEl.value
    if (!el) return
    const logContent = el.querySelector('.n-log .n-scrollbar-container') || el.querySelector('.n-log')
    if (!(logContent instanceof HTMLElement)) return
    logContent.scrollTop = logContent.scrollHeight
  },
)

defineExpose<BatchMergeConfirmDialogExposed>({
  confirmRun,
  stopRunning,
})
</script>

<style scoped>
.log-wrapper {
  margin-top: 16px;
}

.conflict-bar {
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.hint {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
}
</style>
