<template>
  <n-modal
    preset="dialog"
    :show="show"
    :style="modalStyle"
    :title="finishTitle"
    @update:show="setShow"
  >
    <n-space vertical>
      <template v-if="summary?.merged.length">
        <div class="section-title">
          <n-text type="success">
            成功合并 ({{ summary.merged.length }})
          </n-text>
        </div>
        <n-space vertical>
          <n-text
            v-for="(m, i) in summary.merged"
            :key="`m-${i}`"
          >
            ✓ {{ m.source }} -> {{ m.target }}
          </n-text>
        </n-space>
      </template>

      <template v-if="summary?.conflicts.length">
        <div class="section-title">
          <n-text type="warning">
            存在冲突，已跳过并取消 PR ({{ summary.conflicts.length }})
          </n-text>
        </div>
        <n-space vertical>
          <n-text
            v-for="(c, i) in summary.conflicts"
            :key="`c-${i}`"
          >
            ✗ {{ c.source }} -> {{ c.target }}（{{ c.reason || '检测到冲突' }}）
          </n-text>
        </n-space>
      </template>

      <template v-if="summary?.failures.length">
        <div class="section-title">
          <n-text type="error">
            失败 ({{ summary.failures.length }})
          </n-text>
        </div>
        <n-space vertical>
          <n-text
            v-for="(f, i) in summary.failures"
            :key="`f-${i}`"
          >
            ✗ {{ f.source }} -> {{ f.target }}（{{ f.reason || '未知原因' }}）
          </n-text>
        </n-space>
      </template>

      <template v-if="summary?.noop.length">
        <div class="section-title">
          <n-text depth="3">
            无变更，已跳过 ({{ summary.noop.length }})
          </n-text>
        </div>
        <n-space vertical>
          <n-text
            v-for="(n, i) in summary.noop"
            :key="`n-${i}`"
            depth="3"
          >
            {{ n.source }} -> {{ n.target }}（{{ n.reason || '无变更' }}）
          </n-text>
        </n-space>
      </template>

      <n-text
        v-if="summary?.message"
        type="error"
      >
        {{ summary.message }}
      </n-text>

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
 * 用途：批量合并结束后的结果弹窗，按分支展示成功/冲突/失败明细与完整日志。
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
    if (s.merged.length === 0 && s.noop.length > 0) return '合并完成（无变更）'
    return '合并完成'
  }
  if (s.merged.length) return '部分合并完成'
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
  margin-top: 8px;
}
</style>
