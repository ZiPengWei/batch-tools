<template>
  <n-modal
    preset="dialog"
    :show="show"
    :style="modalStyle"
    :title="finishTitle"
    @update:show="setShow"
  >
    <n-space vertical>
      <template v-if="summary?.ok">
        <n-text v-if="summary.mergedCount">
          成功 MR: {{ summary.mergedCount }} 个
        </n-text>
        <n-text v-else-if="summary.noopCount">
          本次无变更，已跳过: {{ summary.noopCount }} 项
        </n-text>
        <n-text v-else>
          成功 MR: 0 个
        </n-text>
        <n-text v-if="summary.mergedCount && summary.noopCount">
          已跳过无变更: {{ summary.noopCount }} 项
        </n-text>
      </template>
      <template v-else>
        <n-text v-if="summary">
          冲突/失败: {{ summary.conflictsCount }} 项
        </n-text>
        <n-text v-if="summary?.rolledBack">
          已回滚本次创建的 MR
        </n-text>
        <n-text
          v-if="summary?.message"
          type="error"
        >
          {{ summary.message }}
        </n-text>
      </template>

      <div class="section-title">
        <n-text depth="3">
          操作日志
        </n-text>
      </div>
      <n-log
        :log="logLines.join('\n')"
        :rows="10"
        :style="logBoxStyle"
      />
    </n-space>
    <template #action>
      <n-button
        type="primary"
        @click="close"
      >
        关闭
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * BatchMergeFinishDialog
 * 用途：批量合并结束后的结果弹窗，展示摘要与完整日志。
 *
 * Props：
 * - show: 是否显示弹窗（v-model:show）
 * - summary: 合并结果摘要（可能为 null）
 * - logLines: 日志文本行数组
 * - modalWidth: 弹窗宽度
 *
 * Emits：
 * - update:show: (val: boolean) 控制弹窗显示
 */
import { computed } from 'vue'
import type { MergeRunSummary } from '../store/merge'
import { NButton, NLog, NModal, NSpace, NText, useThemeVars } from '../ui/naive'

const props = withDefaults(
  defineProps<{
    show: boolean
    summary: MergeRunSummary | null
    logLines: string[]
    modalWidth?: string
  }>(),
  {
    modalWidth: 'min(600px, 92vw)',
  },
)

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void
}>()

const finishTitle = computed(() => {
  const s = props.summary
  if (!s) return '合并结果'
  if (s.ok) {
    if (s.mergedCount === 0 && s.noopCount > 0) return '合并完成（无变更）'
    return '合并完成'
  }
  return '合并失败'
})

const modalStyle = computed(() => ({
  width: props.modalWidth,
}))

const themeVars = useThemeVars()
const logBoxStyle = computed(() => {
  const v = themeVars.value
  return {
    border: `1px solid ${v.borderColor}`,
    borderRadius: v.borderRadiusSmall,
    padding: '8px',
  } as const
})

function setShow(val: boolean) {
  emit('update:show', val)
}

function close() {
  setShow(false)
}
</script>

<style scoped>
.section-title {
  display: block;
}
</style>
