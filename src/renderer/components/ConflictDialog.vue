<template>
  <div
    v-if="visible"
    class="conflict-modal"
  >
    <div class="conflict-dialog">
      <div class="conflict-header">
        <div>
          <h2 class="conflict-title">
            解决冲突: {{ currentFile?.new_path || 'Unknown File' }}
          </h2>
          <div class="conflict-subtitle">
            合并: {{ source }} (Incoming) -> {{ target }} (Current)
          </div>
        </div>
        <div class="conflict-header-actions">
          <n-button
            v-if="conflictFiles.length && compactMode"
            :disabled="loading"
            @click="toggleSidebarDrawer"
          >
            {{
              sidebarDrawerOpen ? '收起文件列表' : '打开文件列表' }}
          </n-button>
          <a
            v-if="mrWebUrl"
            class="conflict-link"
            href="#"
            @click.prevent="openMrLink"
          >
            查看 MR !{{ conflictData?.mrIid }}
          </a>
          <n-button
            :disabled="loading || conflictCandidateCount === 0"
            @click="jumpConflict(-1)"
          >
            上一个冲突
          </n-button>
          <n-button
            :disabled="loading || conflictCandidateCount === 0"
            @click="jumpConflict(1)"
          >
            下一个冲突
          </n-button>
          <span class="conflict-progress">已解决: {{ resolvedCount }} / {{ totalCount }}</span>
          <span
            v-if="pendingActionsCount"
            class="conflict-progress"
          >已暂存: {{ pendingActionsCount }}</span>
          <span class="conflict-progress">
            进度: {{ progressCurrent }} / {{ conflictFiles.length }}
          </span>
          <span
            v-if="conflictBlockCount"
            class="conflict-progress"
          >冲突块: {{ conflictBlockCount }}</span>
          <span
            v-if="autoProcessedCount"
            class="conflict-progress"
          >已自动处理: {{ autoProcessedCount }}</span>
          <span
            v-if="zeroConflictFiles.length"
            class="conflict-progress"
          >
            {{ showAllFiles ? '无冲突文件' : '已过滤无冲突文件' }}: {{ zeroConflictFiles.length }}
          </span>
          <n-button
            v-if="allConflictFiles.length"
            :disabled="loading"
            @click="showAllFiles = !showAllFiles"
          >
            {{ showAllFiles ? '仅显示冲突文件' : '显示所有文件' }}
          </n-button>
          <span
            v-if="conflictCountScan.total"
            class="conflict-progress"
          >
            冲突统计: {{ conflictCountScan.done }} / {{ conflictCountScan.total }}
          </span>
          <span
            v-if="conflictCountScan.running"
            class="conflict-progress"
          >
            统计耗时: {{ conflictCountScanElapsedText }}
          </span>
          <span
            v-if="conflictCountScanMemoryText"
            class="conflict-progress"
          >
            内存: {{ conflictCountScanMemoryText }}
          </span>
        </div>
      </div>

      <div class="conflict-editor">
        <div class="conflict-body">
          <div
            v-if="conflictFiles.length && compactMode && sidebarDrawerOpen"
            class="sidebar-mask"
            @click="sidebarDrawerOpen = false"
          />
          <div
            v-if="conflictFiles.length"
            class="conflict-sidebar"
            :class="{ drawer: compactMode, open: sidebarDrawerOpen }"
          >
            <div class="conflict-sidebar-header">
              <div class="conflict-sidebar-title">
                冲突文件
              </div>
              <div class="conflict-sidebar-subtitle">
                已选择: {{ selectedCount }} / {{ conflictFiles.length }}
              </div>
              <div
                v-if="autoProcessedCount"
                class="conflict-sidebar-subtitle"
              >
                已自动处理无冲突文件: {{ autoProcessedCount }} 个
              </div>
              <div
                v-if="autoProcessedCount"
                class="conflict-sidebar-subtitle"
              >
                部分文件已自动合并并从列表中隐藏，无需手动介入。
              </div>
              <div
                v-if="conflictListLoading"
                class="conflict-sidebar-subtitle"
              >
                <span class="mini-spinner" />
                冲突列表拉取中...
              </div>
              <div
                v-if="conflictListError"
                class="conflict-sidebar-subtitle"
              >
                {{ conflictListError }}
              </div>
              <div
                v-if="uiError"
                class="conflict-sidebar-subtitle"
              >
                {{ uiError }}
              </div>
              <div class="conflict-sidebar-actions">
                <n-button
                  :disabled="loading"
                  @click="selectAll"
                >
                  全选
                </n-button>
                <n-button
                  :disabled="loading"
                  @click="selectNone"
                >
                  全不选
                </n-button>
                <n-button
                  :disabled="loading"
                  @click="selectUnresolved"
                >
                  仅选未解决
                </n-button>
              </div>
            </div>
            <div class="conflict-file-list">
              <n-checkbox-group v-model:value="selectedPaths">
                <div
                  v-for="f in conflictFiles"
                  :key="f.new_path"
                  class="conflict-file-row"
                  :class="{ active: f.new_path === currentFile?.new_path }"
                  @click="onFileClickWithAutoResolve(f)"
                >
                  <label
                    class="conflict-file-check"
                    @click.stop
                  >
                    <n-checkbox
                      :disabled="loading"
                      :value="f.new_path"
                    />
                  </label>
                  <button
                    class="conflict-file-open"
                    :disabled="loading"
                    type="button"
                    @click.stop="onFileClickWithAutoResolve(f)"
                  >
                    <span
                      class="conflict-file-path"
                      :title="f.new_path"
                    >{{ f.new_path }}</span>
                    <div class="conflict-file-meta">
                      <span
                        class="conflict-file-status"
                        :class="{ ok: isResolved(f.new_path) }"
                      >
                        {{ isResolved(f.new_path) ? '已解决' : '未解决' }}
                      </span>
                      <span
                        v-if="choiceLabel(f.new_path)"
                        class="conflict-file-choice"
                      >
                        {{ choiceLabel(f.new_path) }}
                      </span>
                    </div>
                  </button>
                  <div class="conflict-file-actions">
                    <n-button
                      :disabled="loading"
                      @click.stop="openDiff(f)"
                    >
                      差异
                    </n-button>
                  </div>
                </div>
              </n-checkbox-group>
            </div>
            <div
              v-if="opHistory.length"
              class="conflict-history"
            >
              <div class="conflict-history-title">
                操作记录
              </div>
              <div class="conflict-history-list">
                <div
                  v-for="(h, idx) in opHistory"
                  :key="idx"
                  class="conflict-history-item"
                >
                  {{ h }}
                </div>
              </div>
            </div>
          </div>

          <div class="conflict-editor-main">
            <div
              v-if="conflictFiles.length"
              class="merge-panes-header"
            >
              <template v-if="compactMode">
                <n-button @click="setVisiblePane('left')">
                  本地（{{ target }}）
                </n-button>
                <n-button @click="setVisiblePane('middle')">
                  结果（可编辑）
                </n-button>
                <n-button @click="setVisiblePane('right')">
                  远程（{{ source }}）
                </n-button>
              </template>
              <template v-else>
                <div class="merge-pane-title">
                  本地版本（{{ target }}）
                </div>
                <div class="merge-pane-title middle">
                  合并基础（可编辑）
                </div>
                <div class="merge-pane-title">
                  远程版本（{{ source }}）
                </div>
              </template>
            </div>
            <div class="conflict-editor-host">
              <div
                class="pane-wrap"
                :class="{ hidden: compactMode && visiblePane !== 'left' }"
              >
                <div
                  ref="editorLeftContainer"
                  class="pane"
                />
              </div>
              <div
                ref="editorMiddleWrap"
                class="pane-wrap middle"
                :class="{ hidden: compactMode && visiblePane !== 'middle' }"
              >
                <div
                  ref="editorMiddleContainer"
                  class="pane"
                />
                <div
                  v-if="webstormOverlayItems.length"
                  class="webstorm-merge-overlay"
                >
                  <div
                    v-for="it in webstormOverlayItems"
                    :key="it.id"
                    class="webstorm-merge-control"
                    :style="{ top: it.top + 'px' }"
                  >
                    <n-button @click="applySideToBlock('left', it.id)">
                      →
                    </n-button>
                    <n-button @click="applySideToBlock('right', it.id)">
                      ←
                    </n-button>
                  </div>
                </div>
              </div>
              <div
                class="pane-wrap"
                :class="{ hidden: compactMode && visiblePane !== 'right' }"
              >
                <div
                  ref="editorRightContainer"
                  class="pane"
                />
              </div>
            </div>
            <div
              v-if="loading"
              class="conflict-overlay"
            >
              <span class="conflict-overlay-text">加载文件内容中...</span>
            </div>
            <div
              v-else-if="conflictCountScan.running"
              class="conflict-overlay"
            >
              <span class="conflict-overlay-text">正在统计冲突块并过滤无冲突文件...</span>
            </div>
            <div
              v-else-if="fileLoadError"
              class="conflict-overlay"
            >
              <div class="conflict-empty">
                <p class="conflict-empty-title">
                  文件加载失败
                </p>
                <p class="conflict-empty-subtitle">
                  {{ fileLoadError }}
                </p>
              </div>
            </div>
            <div
              v-else-if="conflictFiles.length === 0 && pendingActionsCount === 0"
              class="conflict-overlay scrollable"
            >
              <div class="conflict-empty">
                <p class="conflict-empty-title">
                  未找到冲突文件
                </p>
                <p class="conflict-empty-subtitle">
                  GitLab API 返回的冲突列表为空。可能是二进制文件冲突或已被其他操作解决。
                </p>
                <div class="conflict-empty-actions">
                  <n-button
                    :disabled="loading || emptyRefreshLoading"
                    @click="refreshConflictList"
                  >
                    {{ emptyRefreshLoading ? '拉取中...' : '重新拉取冲突列表' }}
                  </n-button>
                  <n-button
                    :disabled="loading || emptyMrRefreshLoading"
                    @click="refreshMrStatus"
                  >
                    {{ emptyMrRefreshLoading ? '刷新中...' : '刷新 MR 状态' }}
                  </n-button>
                  <n-button
                    :disabled="loading || localGitLoading"
                    @click="prepareLocalGitConflicts"
                  >
                    {{ localGitLoading ? '本地检测中...' : '使用本地 Git 检测冲突' }}
                  </n-button>
                </div>
                <p
                  v-if="emptyRefreshError"
                  class="conflict-empty-subtitle"
                >
                  {{ emptyRefreshError }}
                </p>
                <p
                  v-if="emptyMrRefreshError"
                  class="conflict-empty-subtitle"
                >
                  {{ emptyMrRefreshError }}
                </p>
                <p
                  v-if="localGitError"
                  class="conflict-empty-subtitle"
                >
                  {{ localGitError }}
                </p>
                <div
                  v-if="emptyStateAnalysis.length"
                  class="conflict-empty-files"
                >
                  <div class="conflict-empty-files-title">
                    可能原因与建议
                  </div>
                  <div class="conflict-empty-files-list">
                    <div
                      v-for="(t, idx) in emptyStateAnalysis"
                      :key="'a' + idx"
                      class="conflict-empty-file"
                    >
                      {{ t }}
                    </div>
                    <div class="conflict-empty-file">
                      建议操作：1) 点击“重新拉取冲突列表”；2) 若 MR 状态已不冲突，点击“我已在 GitLab 解决”继续检测；3)
                      若持续为空且提示权限异常或冲突接口返回 HTML/登录页，请更换有权限的 Token 或在 GitLab 中直接完成冲突解决；4) 解决完毕后使用“使用 GitLab 提交”或“提交到源分支”完成确认。
                    </div>
                  </div>
                </div>
                <p
                  v-if="relatedFilesLoading"
                  class="conflict-empty-subtitle"
                >
                  正在获取 MR 变更文件列表...
                </p>
                <p
                  v-else-if="relatedFilesError"
                  class="conflict-empty-subtitle"
                >
                  {{ relatedFilesError }}
                </p>
                <div
                  v-else-if="relatedFiles.length"
                  class="conflict-empty-files"
                >
                  <div class="conflict-empty-files-title">
                    MR 变更文件（供排查）
                  </div>
                  <div class="conflict-empty-files-list">
                    <div
                      v-for="(f, idx) in relatedFiles"
                      :key="idx"
                      class="conflict-empty-file file-row"
                    >
                      <n-button
                        :disabled="loading"
                        @click="openAdhocMerge(f)"
                      >
                        {{ f }}
                      </n-button>
                      <n-button
                        :disabled="loading"
                        @click="openAdhocMerge(f)"
                      >
                        三方合并
                      </n-button>
                    </div>
                  </div>
                  <div
                    v-if="relatedBinaryCandidates.length"
                    class="conflict-empty-files"
                  >
                    <div class="conflict-empty-files-title">
                      疑似二进制/不可三方合并文件（按扩展名推断）
                    </div>
                    <div class="conflict-empty-files-list">
                      <div
                        v-for="(f, idx) in relatedBinaryCandidates"
                        :key="idx"
                        class="conflict-empty-file"
                      >
                        {{ f }}
                      </div>
                    </div>
                  </div>
                </div>
                <p
                  v-if="gitattributesLoading"
                  class="conflict-empty-subtitle"
                >
                  正在获取 .gitattributes ...
                </p>
                <p
                  v-else-if="gitattributesError"
                  class="conflict-empty-subtitle"
                >
                  {{ gitattributesError }}
                </p>
                <div
                  v-else-if="gitattributesSource || gitattributesTarget"
                  class="conflict-empty-files"
                >
                  <div class="conflict-empty-files-title">
                    .gitattributes（供排查）
                  </div>
                  <div class="conflict-empty-files-list">
                    <div class="conflict-empty-file">
                      目标分支({{ target }}):
                    </div>
                    <div
                      v-if="gitattributesTarget"
                      class="conflict-empty-file pre"
                    >
                      {{ gitattributesTarget }}
                    </div>
                    <div
                      v-else
                      class="conflict-empty-file pre"
                    >
                      （不存在或无权限读取）
                    </div>
                    <div
                      class="conflict-empty-file"
                      style="margin-top: 10px;"
                    >
                      源分支({{ source }}):
                    </div>
                    <div
                      v-if="gitattributesSource"
                      class="conflict-empty-file pre"
                    >
                      {{ gitattributesSource }}
                    </div>
                    <div
                      v-else
                      class="conflict-empty-file pre"
                    >
                      （不存在或无权限读取）
                    </div>
                  </div>
                </div>
                <div
                  v-if="conflictApiDebug"
                  class="conflict-empty-files"
                >
                  <div class="conflict-empty-files-title">
                    冲突接口诊断（脱敏）
                  </div>
                  <div class="conflict-empty-files-list">
                    <div class="conflict-empty-file pre">
                      {{ conflictApiDebugText }}
                    </div>
                  </div>
                </div>
                <div
                  v-if="mrDetailsText"
                  class="conflict-empty-files"
                >
                  <div class="conflict-empty-files-title">
                    MR 合并状态（供排查）
                  </div>
                  <div class="conflict-empty-files-list">
                    <div class="conflict-empty-file pre">
                      {{ mrDetailsText }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else-if="conflictFiles.length === 0 && pendingActionsCount > 0"
              class="conflict-overlay scrollable"
            >
              <div class="conflict-empty">
                <p class="conflict-empty-title">
                  无实际冲突
                </p>
                <p class="conflict-empty-subtitle">
                  已自动生成并暂存合并结果，可直接完成合并。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="conflict-footer">
        <div class="conflict-footer-left">
          <span class="conflict-hint">左侧: 本地版本 ({{ target }})，中间: 合并结果，右侧: 远程版本 ({{ source }})。Tab 切换面板，Cmd/Ctrl+Enter
            暂存并前进，Cmd/Ctrl+1/2 替换结果当前行为本地/远程，Cmd/Ctrl+Shift+1/2 替换结果选区为本地/远程。</span>
        </div>
        <div class="conflict-footer-actions">
          <template v-if="conflictFiles.length === 0 && pendingActionsCount === 0">
            <n-button
              :disabled="loading"
              @click="cancelMerge"
            >
              取消合并
            </n-button>
            <n-button
              :disabled="loading"
              type="primary"
              @click="confirmResolvedExternally"
            >
              我已在 GitLab
              解决，继续检测
            </n-button>
          </template>
          <template v-else-if="conflictFiles.length === 0 && pendingActionsCount > 0">
            <n-button
              :disabled="loading"
              type="error"
              @click="cancelMerge"
            >
              取消合并
            </n-button>
            <n-button
              :disabled="loading"
              @click="openFinalConfirm"
            >
              完成合并
            </n-button>
          </template>
          <template v-else>
            <n-button
              :disabled="loading"
              @click="acceptCurrentBranch"
            >
              接受本地更改
            </n-button>
            <n-button
              :disabled="loading"
              @click="acceptTargetBranch"
            >
              接受远程更改
            </n-button>
            <n-button
              :disabled="loading"
              @click="acceptBothBranches"
            >
              接受两者
            </n-button>
            <n-button
              :disabled="loading || gitMergeLoading"
              @click="applyGitThreeWayMergeToResult"
            >
              {{ gitMergeLoading ? 'Git 合并中...' : 'Git 三方合并' }}
            </n-button>
            <n-button
              :disabled="loading"
              @click="undoEdit"
            >
              撤销
            </n-button>
            <n-button
              :disabled="loading || !isResolved(currentFile?.new_path)"
              @click="unstageCurrentFile"
            >
              撤销暂存
            </n-button>
            <div class="footer-action-group">
              <n-button
                :disabled="loading"
                type="error"
                @click="cancelMerge"
              >
                取消合并
              </n-button>
              <n-button
                :disabled="loading"
                type="primary"
                @click="markResolved"
              >
                {{ isAllResolved ? '完成合并' : '下一个文件' }}
              </n-button>
            </div>
          </template>
        </div>
      </div>

      <div
        v-if="diffVisible"
        class="conflict-overlay"
      >
        <div class="diff-dialog">
          <div class="diff-header">
            <div class="diff-title">
              查看差异: {{ diffFilePath }}
            </div>
            <n-button @click="closeDiff">
              关闭
            </n-button>
          </div>
          <div class="diff-body">
            <div class="diff-panel">
              <div class="diff-panel-title">
                本地版本 ({{ target }})
              </div>
              <div class="diff-code">
                <div
                  v-for="l in diffLines"
                  :key="'l' + l.no"
                  class="diff-line"
                  :class="{ changed: l.changed }"
                >
                  <span class="diff-no">{{ l.no }}</span>
                  <span class="diff-text">{{ l.left }}</span>
                </div>
              </div>
            </div>
            <div class="diff-panel">
              <div class="diff-panel-title">
                远程版本 ({{ source }})
              </div>
              <div class="diff-code">
                <div
                  v-for="l in diffLines"
                  :key="'r' + l.no"
                  class="diff-line"
                  :class="{ changed: l.changed }"
                >
                  <span class="diff-no">{{ l.no }}</span>
                  <span class="diff-text">{{ l.right }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="finalConfirmVisible"
        class="conflict-overlay"
      >
        <div class="confirm-dialog">
          <div class="confirm-title">
            最终确认
          </div>
          <div class="confirm-subtitle">
            可选择提交到源分支，或使用 GitLab resolve_conflicts 提交并标记冲突已解决。
          </div>
          <div
            v-if="autoProcessedCount"
            class="confirm-subtitle"
          >
            包含已自动处理文件，无法使用 GitLab 提交，请选择“提交到源分支”。
          </div>
          <div class="confirm-list">
            <div
              v-for="f in conflictFiles"
              :key="f.new_path"
              class="confirm-item"
            >
              <span class="confirm-path">{{ f.new_path }}</span>
              <span class="confirm-tag">冲突块: {{ typeof f?.conflict_block_count === 'number' && f.conflict_block_count >=
                0 ?
                  f.conflict_block_count : '未知' }}</span>
              <span
                class="confirm-tag"
                :class="{ ok: isResolved(f.new_path) }"
              >{{ isResolved(f.new_path) ? '已暂存' :
                '未暂存'
              }}</span>
              <span class="confirm-tag">{{ choiceLabel(f.new_path) || '未选择' }}</span>
            </div>
          </div>
          <div class="confirm-commit">
            <div class="confirm-commit-title">
              提交说明（commit message）
            </div>
            <n-input
              v-model:value="commitMessage"
              :disabled="loading"
              placeholder="请输入提交说明"
              type="textarea"
            />
            <n-checkbox
              v-model:checked="sourceMapsToHead"
              :disabled="loading"
            >
              源分支对应 head（目标分支对应 origin）
            </n-checkbox>
          </div>
          <div class="confirm-actions">
            <n-button
              :disabled="loading"
              @click="finalConfirmVisible = false"
            >
              返回继续编辑
            </n-button>
            <n-button
              :disabled="loading || resolveConflictsLoading || !canResolveWithGitlab"
              @click="confirmAndResolveConflicts"
            >
              {{ resolveConflictsLoading ? '提交中...' : '使用 GitLab 提交' }}
            </n-button>
            <n-button
              :disabled="loading || !canFinish"
              @click="confirmAndCommit"
            >
              提交到源分支
            </n-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onUnmounted, onMounted, toRaw, nextTick, onErrorCaptured } from 'vue';
import { NButton, NCheckbox, NCheckboxGroup, NInput } from '../ui/naive';
import { getFileContent, getFileMetadata, createCommit, resolveConflict, openExternal, getMergeBase, getMergeRequestChanges, getMergeRequestConflicts, getMergeRequestConflictsFull, getMergeRequest, getMergeRequestConflictForPath, resolveMergeRequestConflicts, localGitPrepareConflicts, localGitGetFileContents, localGitMergeFileContents, localGitCleanup } from '../ipc/bridge';
import { parseGitConflictMarkers } from '../utils/conflictMarkers';

// Ensure styles are loaded
import 'monaco-editor/min/vs/editor/editor.main.css';

const props = defineProps<{
  visible: boolean;
  conflictData: any;
}>();

const emit = defineEmits(['close', 'resolved']);

const useMockData = computed(() => Boolean((props.conflictData as any)?.useMockData));

const editorLeftContainer = ref<HTMLElement>();
const editorMiddleContainer = ref<HTMLElement>();
const editorRightContainer = ref<HTMLElement>();
const editorMiddleWrap = ref<HTMLElement>();

const leftEditor = shallowRef<any>();
const middleEditor = shallowRef<any>();
const rightEditor = shallowRef<any>();
let activeMonaco: any = null;

const viewportWidth = ref(0);
const compactMode = computed(() => viewportWidth.value > 0 && viewportWidth.value <= 1080);
const visiblePane = ref<'left' | 'middle' | 'right'>('middle');
const sidebarDrawerOpen = ref(false);

// Shared loader logic
let monacoInstance: any = null;
let monacoLoader: Promise<any> | null = null;
let webstormThemeApplied = false;

async function loadMonaco() {
  if (monacoInstance) return monacoInstance;
  if (monacoLoader) return monacoLoader;

  if (typeof window === 'undefined') return null;

  monacoLoader = (async () => {
    try {
      const m = await import('monaco-editor');

      const editorWorker = (await import('monaco-editor/esm/vs/editor/editor.worker?worker')).default;
      const jsonWorker = (await import('monaco-editor/esm/vs/language/json/json.worker?worker')).default;
      const cssWorker = (await import('monaco-editor/esm/vs/language/css/css.worker?worker')).default;
      const htmlWorker = (await import('monaco-editor/esm/vs/language/html/html.worker?worker')).default;
      const tsWorker = (await import('monaco-editor/esm/vs/language/typescript/ts.worker?worker')).default;

      (globalThis as any).MonacoEnvironment = {
        getWorker(_: any, label: string) {
          if (label === 'json') return new jsonWorker();
          if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
          if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
          if (label === 'typescript' || label === 'javascript') return new tsWorker();
          return new editorWorker();
        }
      };
      monacoInstance = m;
      try {
        const ed = (m as any)?.editor;
        if (!webstormThemeApplied && ed?.defineTheme && ed?.setTheme) {
          ed.defineTheme('webstorm-light', {
            base: 'vs',
            inherit: true,
            rules: [
              { token: 'comment', foreground: '808080' },
              { token: 'keyword', foreground: '3b5bdb' },
              { token: 'number', foreground: '2f6fdb' },
              { token: 'string', foreground: '2b8a3e' },
              { token: 'type.identifier', foreground: '555555' }
            ],
            colors: {
              'editor.background': '#f5f5f5',
              'editor.foreground': '#555555',
              'editorLineNumber.foreground': '#999999',
              'editorLineNumber.activeForeground': '#666666',
              'editor.selectionBackground': '#a7d3ff',
              'editor.inactiveSelectionBackground': '#a7d3ff66',
              'editorCursor.foreground': '#666666',
              'editorIndentGuide.background1': '#dddddd',
              'editorIndentGuide.activeBackground1': '#cccccc'
            }
          });
          ed.setTheme('webstorm-light');
          webstormThemeApplied = true;
        }
      } catch { }
      return m;
    } catch (e) {
      console.error('加载 Monaco Editor 失败', e);
      return null;
    }
  })();

  return monacoLoader;
}

const focusIndex = ref(1);

function focusPanel(which: 'left' | 'middle' | 'right') {
  const { left, middle, right } = getEditors();
  const ed = which === 'left' ? left : which === 'right' ? right : middle;
  if (ed?.focus) ed.focus();
}

function setVisiblePane(which: 'left' | 'middle' | 'right') {
  visiblePane.value = which;
  focusIndex.value = which === 'left' ? 0 : which === 'middle' ? 1 : 2;
  queueMicrotask(() => {
    onResize();
    focusPanel(which);
  });
}

function toggleSidebarDrawer() {
  sidebarDrawerOpen.value = !sidebarDrawerOpen.value;
  if (!sidebarDrawerOpen.value) return;
  if (visiblePane.value !== 'middle') setVisiblePane('middle');
}

function cyclePanelFocus(dir: number) {
  const order: Array<'left' | 'middle' | 'right'> = ['left', 'middle', 'right'];
  const next = (focusIndex.value + dir + order.length) % order.length;
  focusIndex.value = next;
  const which = order[next];
  if (compactMode.value) visiblePane.value = which;
  focusPanel(which);
}

function jumpConflict(dir: number) {
  const ed = middleEditor.value;
  if (!ed?.getPosition || !ed?.revealLineInCenter || !ed?.setPosition || !ed?.focus) return;
  const lines = Array.from(conflictCandidateLines || []).filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (!lines.length) return;
  const pos = ed.getPosition();
  const current = Number(pos?.lineNumber || 1);
  let idx = lines.findIndex((n) => n >= current);
  if (idx < 0) idx = 0;
  if (dir > 0) {
    const nextIdx = lines.findIndex((n) => n > current);
    idx = nextIdx >= 0 ? nextIdx : 0;
  } else {
    const prev = [...lines].reverse().find((n) => n < current);
    idx = prev != null ? lines.indexOf(prev) : lines.length - 1;
  }
  const line = lines[idx] || lines[0];
  try {
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.focus();
  } catch { }
}

function findConflictBlockAtMiddleLine(line: number) {
  const ln = Number(line || 0);
  if (!ln || !Array.isArray(conflictBlocks) || conflictBlocks.length === 0) return null;
  for (const b of conflictBlocks) {
    const startLine = Math.max(1, Number(b.middleStart + 1));
    const endBoundary = Math.max(0, Number(b.middleEnd));
    if (endBoundary <= b.middleStart) {
      if (ln === startLine) return b;
      continue;
    }
    if (ln >= startLine && ln <= endBoundary) return b;
  }
  return null;
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (loading.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (compactMode.value && sidebarDrawerOpen.value) {
      sidebarDrawerOpen.value = false;
      return;
    }
    cancelMerge();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    cyclePanelFocus(e.shiftKey ? -1 : 1);
    return;
  }
  const enter = e.key === 'Enter';
  const mod = e.metaKey || e.ctrlKey;
  if (enter && mod) {
    e.preventDefault();
    markResolved();
    return;
  }
  if (mod && e.shiftKey && (e.key === '1' || e.key === '2')) {
    e.preventDefault();
    replaceSelectionFromPanel(e.key === '1' ? 'left' : 'right');
    return;
  }
  if (mod && (e.key === '1' || e.key === '2')) {
    e.preventDefault();
    replaceCurrentLineFromPanel(e.key === '1' ? 'left' : 'right');
    return;
  }
  if (e.key === 'F7') {
    e.preventDefault();
    jumpConflict(e.shiftKey ? -1 : 1);
    return;
  }
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
  const webstormApplyMod = isMac ? e.ctrlKey : e.altKey;
  if (webstormApplyMod && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const pos = middleEditor.value?.getPosition?.();
    const line = Number(pos?.lineNumber || 0);
    const block = line ? findConflictBlockAtMiddleLine(line) : null;
    if (block?.id) applySideToBlock(e.key === 'ArrowLeft' ? 'left' : 'right', String(block.id));
    else replaceCurrentLineFromPanel(e.key === 'ArrowLeft' ? 'left' : 'right');
    return;
  }
}

function onResize() {
  try {
    viewportWidth.value = Number(window.innerWidth || 0);
  } catch { }
  try {
    leftEditor.value?.layout?.();
    middleEditor.value?.layout?.();
    rightEditor.value?.layout?.();
  } catch { }
  updateWebstormOverlay();
}

onMounted(() => {
  loadMonaco();
  onResize();
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', onResize, true);
});

const loading = ref(false);
const conflictListLoading = ref(false);
const conflictListError = ref('');
const uiError = ref('');
const currentIndex = ref(0);
const conflictFiles = ref<any[]>([]);
const allConflictFiles = ref<any[]>([]);
const zeroConflictFiles = ref<any[]>([]);
const currentFile = ref<any>(null);

const projectId = ref(0);
const source = ref('');
const target = ref('');
const runId = ref('');
const mrWebUrl = ref('');
const leftSnapshot = ref('');
const baseSnapshot = ref('');
const rightSnapshot = ref('');
const pendingActions = ref<any[]>([]);
const fileStates = ref<Record<string, { content: string | null; undo: string[] }>>({});
const selectedPaths = ref<string[]>([]);
const opHistory = ref<string[]>([]);
const relatedFiles = ref<string[]>([]);
const relatedFilesLoading = ref(false);
const relatedFilesError = ref('');
const conflictApiDebug = ref<any>(null);
const mrDetails = ref<any>(null);
const gitattributesLoading = ref(false);
const gitattributesError = ref('');
const gitattributesTarget = ref('');
const gitattributesSource = ref('');
const finalConfirmVisible = ref(false);
const diffVisible = ref(false);
const diffFilePath = ref('');
const diffLeft = ref('');
const diffRight = ref('');
const fileLoadError = ref('');
const emptyRefreshLoading = ref(false);
const emptyRefreshError = ref('');
const emptyMrRefreshLoading = ref(false);
const emptyMrRefreshError = ref('');
const webstormOverlayItems = ref<Array<{ id: string; line: number; top: number }>>([]);
function applyWebstormOverlayPointerPolicy() {
  const wrap = editorMiddleWrap.value;
  if (!wrap) return;
  const overlay = wrap.querySelector('.webstorm-merge-overlay') as HTMLElement | null;
  if (overlay) overlay.style.pointerEvents = 'none';
  const controls = wrap.querySelectorAll('.webstorm-merge-control') as NodeListOf<HTMLElement>;
  for (const el of controls) {
    el.style.pointerEvents = 'none';
  }
  const buttons = wrap.querySelectorAll(
    '.webstorm-merge-overlay button, .webstorm-merge-btn'
  ) as NodeListOf<HTMLElement>;
  for (const el of buttons) el.style.pointerEvents = 'auto';
}
const conflictBlockCount = ref(0);
const conflictCandidateCount = ref(0);
const autoProcessedFiles = ref<Array<{ new_path: string; conflict_block_count: number }>>([]);
const showAllFiles = ref(false);
const deferListRenderUntilScanDone = ref(false);

const autoResolveToken = ref(0);
const autoResolveTriggeredToken = ref(0);
const autoResolveExpectedPath = ref('');
const autoResolveArmedDecorationSeq = ref(0);
const decorationSeq = ref(0);
const autoResolvedOnceByPath = ref<Record<string, boolean>>({});

function getAutoResolveKey(filePath: string) {
  const fp = String(filePath || '').trim();
  const rid = String(runId.value || '').trim();
  if (!fp) return '';
  if (!rid) return fp;
  return `${rid}::${fp}`;
}

function hasAutoResolvedOnce(filePath: string) {
  const key = getAutoResolveKey(filePath);
  if (!key) return false;
  return Boolean(autoResolvedOnceByPath.value[key]);
}

function markAutoResolvedOnce(filePath: string) {
  const key = getAutoResolveKey(filePath);
  if (!key) return;
  autoResolvedOnceByPath.value = { ...autoResolvedOnceByPath.value, [key]: true };
}

const AUTO_RESOLVE_REASON_FILE_CLICK = 'file_click';
const AUTO_RESOLVE_REASON_AFTER_HANDLE_FILE_CLICK = 'after_handleFileClick';
const AUTO_RESOLVE_REASON_WATCH = 'watch';
const AUTO_RESOLVE_REASON_ZERO_CONFLICT = 'zero_conflict_file_click';

function buildAutoResolveLog(reason: string) {
  const filePath = String(currentFile.value?.new_path || '').trim();
  const ts = new Date();
  return {
    at: ts.getTime(),
    iso: ts.toISOString(),
    filePath,
    conflictBlockCount: Number(conflictBlockCount.value || 0),
    reason,
    token: Number(autoResolveToken.value || 0)
  };
}

function logAutoResolve(reason: string) {
  const payload = buildAutoResolveLog(reason);
  addHistory(
    `自动触发 markResolved：path=${payload.filePath || 'unknown'} conflictBlockCount=${payload.conflictBlockCount} reason=${payload.reason} at=${payload.iso}`
  );
  console.info('自动触发 markResolved', payload);
}

function armAutoResolve(expectedPath: string, reason: string) {
  const fp = String(expectedPath || '').trim();
  if (!fp) return;
  if (hasAutoResolvedOnce(fp)) return;
  autoResolveExpectedPath.value = fp;
  autoResolveToken.value += 1;
  autoResolveTriggeredToken.value = 0;
  autoResolveArmedDecorationSeq.value = decorationSeq.value;
  const ts = new Date().toISOString();
  addHistory(`已启用自动检测：path=${autoResolveExpectedPath.value || 'unknown'} reason=${reason} at=${ts}`);
}

function disarmAutoResolve() {
  autoResolveToken.value = 0;
  autoResolveTriggeredToken.value = 0;
  autoResolveExpectedPath.value = '';
  autoResolveArmedDecorationSeq.value = decorationSeq.value;
}

async function maybeAutoResolve(reason: string) {
  const token = Number(autoResolveToken.value || 0);
  if (!token) return;
  if (!props.visible) return;
  if (loading.value) return;
  if (decorationSeq.value <= autoResolveArmedDecorationSeq.value) return;
  if (autoResolveTriggeredToken.value === token) return;

  const expected = String(autoResolveExpectedPath.value || '').trim();
  const currentPath = String(currentFile.value?.new_path || '').trim();
  if (!currentPath) return;
  if (hasAutoResolvedOnce(currentPath)) return;
  if (expected && expected !== currentPath) return;

  if (conflictBlockCount.value !== 0) {
    disarmAutoResolve();
    return;
  }

  autoResolveTriggeredToken.value = token;
  try {
    logAutoResolve(reason);
    await markResolved();
    markAutoResolvedOnce(currentPath);
    disarmAutoResolve();
  } catch (e) {
    const msg = `自动 markResolved 异常：${String(e)}`;
    uiError.value = msg;
    addHistory(msg);
    console.error(msg, e);
  }
}

watch(
  () => [
    autoResolveToken.value,
    autoResolveExpectedPath.value,
    decorationSeq.value,
    conflictBlockCount.value,
    loading.value,
    props.visible,
    String(currentFile.value?.new_path || '').trim()
  ],
  () => {
    void maybeAutoResolve(AUTO_RESOLVE_REASON_WATCH);
  },
  { flush: 'post' }
);

async function onFileClickWithAutoResolve(file: any) {
  if (loading.value) return;
  const fp = String(file?.new_path || '').trim();
  armAutoResolve(fp, AUTO_RESOLVE_REASON_FILE_CLICK);
  try {
    await handleFileClick(file);
  } catch (e) {
    const msg = `文件点击流程异常：${String(e)}`;
    uiError.value = msg;
    addHistory(msg);
    console.error(msg, e);
    return;
  }
  await maybeAutoResolve(AUTO_RESOLVE_REASON_AFTER_HANDLE_FILE_CLICK);
}

function getKnownConflictBlockCountForPreserve(f: any): number | null {
  const v = (f as any)?.conflict_block_count;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function isZeroConflictFile(f: any) {
  const v = (f as any)?.conflict_block_count;
  if (v === 0) return true;
  if (typeof v === 'string' && v.trim() === '0') return true;
  return false;
}

function applyUiFiltersNow() {
  if (deferListRenderUntilScanDone.value) {
    conflictFiles.value = [];
    return;
  }
  const list = Array.isArray(allConflictFiles.value) ? allConflictFiles.value : [];
  const next = showAllFiles.value ? list : list.filter((f: any) => !isZeroConflictFile(f));
  conflictFiles.value = next;
  if (!showAllFiles.value) {
    const leaked = next.filter((f: any) => isZeroConflictFile(f));
    if (leaked.length) {
      console.error(`过滤异常：列表中仍存在冲突块为 0 的文件：${leaked.map((x: any) => String(x?.new_path || '')).join(', ')}`);
    }
  }
  if (!next.length) {
    currentIndex.value = 0;
    if (currentFile.value) currentFile.value = null;
    return;
  }
  const curPath = String(currentFile.value?.new_path || '').trim();
  if (curPath && !next.some((x: any) => String(x?.new_path || '').trim() === curPath)) {
    currentFile.value = null;
    currentIndex.value = 0;
    return;
  }
  const idx = curPath ? next.findIndex((x: any) => String(x?.new_path || '').trim() === curPath) : -1;
  if (idx >= 0) currentIndex.value = idx;
  else currentIndex.value = Math.max(0, Math.min(currentIndex.value, next.length - 1));
}

watch(showAllFiles, () => applyUiFiltersNow());
watch(webstormOverlayItems, async () => {
  await nextTick();
  applyWebstormOverlayPointerPolicy();
});

onErrorCaptured((err) => {
  const msg = `界面错误：${String(err)}`;
  uiError.value = msg;
  addHistory(msg);
  console.error('界面错误：', err);
  return false;
});
type ConflictBlockScanState = {
  running: boolean;
  reason: string;
  total: number;
  done: number;
  ok: number;
  error: number;
  timeout: number;
  binary: number;
  skipped: number;
  startedAt: number;
  lastUpdatedAt: number;
};
const conflictCountScan = ref<ConflictBlockScanState>({
  running: false,
  reason: '',
  total: 0,
  done: 0,
  ok: 0,
  error: 0,
  timeout: 0,
  binary: 0,
  skipped: 0,
  startedAt: 0,
  lastUpdatedAt: 0
});
let conflictCountScanSeq = 0;
let autoScanTriggeredForRunId = '';
const localGitEnabled = ref(false);
const localGitLoading = ref(false);
const localGitError = ref('');
const gitMergeLoading = ref(false);
const gitMergeError = ref('');
const resolveConflictsLoading = ref(false);
const commitMessage = ref('');
const sourceMapsToHead = ref(true);

type FileChoice = 'local' | 'remote' | 'both' | 'manual';
const fileChoices = ref<Record<string, FileChoice>>({});
let suppressResultTracking = false;
let changeDebounceTimer: any = null;
let lastRecordedResultValue = '';
let decorationDebounceTimer: any = null;

const progressCurrent = computed(() =>
  conflictFiles.value.length ? currentIndex.value + 1 : 0
);
const pendingActionsCount = computed(() => pendingActions.value.length);
const totalCount = computed(() => conflictFiles.value.length);
const autoProcessedCount = computed(() => autoProcessedFiles.value.length);
const resolvedCount = computed(() => {
  const s = new Set<string>();
  for (const a of pendingActions.value) {
    const p = a?.file_path;
    if (typeof p === 'string' && p.trim()) s.add(p);
  }
  return s.size;
});
const selectedCount = computed(() => selectedPaths.value.length);
const isAllResolved = computed(() => resolvedCount.value >= totalCount.value && totalCount.value > 0);
const canFinish = computed(() => resolvedCount.value >= totalCount.value);

const conflictCountScanElapsedText = computed(() => {
  const st = conflictCountScan.value;
  if (!st?.startedAt) return '';
  const ms = Math.max(0, Date.now() - st.startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.round(ms / 1000)}s`;
});

const conflictCountScanMemoryText = computed(() => {
  try {
    const anyPerf = performance as any;
    const mem = anyPerf?.memory;
    const used = Number(mem?.usedJSHeapSize ?? 0);
    if (!used) return '';
    const mb = Math.round((used / 1024 / 1024) * 10) / 10;
    return `${mb}MB`;
  } catch {
    return '';
  }
});

const canResolveWithGitlab = computed(() => {
  const iid = Number(props.conflictData?.mrIid || 0);
  if (!iid) return false;
  if (!mrWebUrl.value) return false;
  if (!conflictFiles.value.length) return false;
  if (autoProcessedCount.value > 0) return false;
  const msg = String(commitMessage.value || '').trim();
  if (!msg) return false;
  for (const f of conflictFiles.value) {
    const fp = String(f?.new_path || '').trim();
    if (!fp) return false;
    const choice = fileChoices.value[fp];
    if (choice !== 'local' && choice !== 'remote') return false;
  }
  return true;
});

const emptyStateAnalysis = computed(() => {
  const lines: string[] = [];
  const api = conflictApiDebug.value;
  const status = api?.status;
  const ok = api?.ok;
  if (status === 401 || status === 403) {
    lines.push(`冲突接口返回 ${String(status)}，当前 Token 或成员权限不足，无法获取冲突明细。`);
  } else if (status === 404) {
    lines.push(`冲突接口返回 404，MR 或项目不可见/不存在，或 Token 无访问权限。`);
  } else if (ok === false && status != null) {
    lines.push(`冲突接口调用失败（HTTP ${String(status)}），冲突明细可能不可用。`);
  }
  const d = mrDetails.value as any;
  if (d) {
    const mergeStatus = d?.merge_status;
    const detailed = d?.detailed_merge_status;
    const hasConflicts = d?.has_conflicts;
    if (hasConflicts === false && detailed !== 'conflicts' && mergeStatus !== 'cannot_be_merged') {
      lines.push('MR 当前状态未标记为冲突，可能已被他人或自动化流程解决。');
    } else if (hasConflicts || detailed === 'conflicts' || mergeStatus === 'cannot_be_merged') {
      lines.push('MR 标记为冲突，但冲突文件列表为空：可能是二进制/大文件冲突、或 GitLab 未返回 files 明细。');
    }
  }
  if (relatedBinaryCandidates.value.length) {
    lines.push(`疑似二进制/不可三方合并文件（按扩展名推断）：${relatedBinaryCandidates.value.slice(0, 6).join(', ')}${relatedBinaryCandidates.value.length > 6 ? '…' : ''}`);
  }
  return lines;
});

let emptyAutoRefreshed = false;
let localGitAutoTriggered = false;
let pendingOpenFile: any | null = null;
let relatedAdhocAutoOpened = false;
let editorInitRetryCount = 0;

function normalizeConflictFiles(files: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(files)) return out;
  for (const raw of files) {
    const p = String(raw?.new_path ?? '').trim();
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ ...(raw || {}), new_path: p });
  }
  return out;
}

function stageUpdateAction(filePath: string, content: string, choice?: FileChoice) {
  const fp = String(filePath || '').trim();
  if (!fp) return;
  const actions = pendingActions.value.filter((a) => a?.file_path !== fp);
  actions.push({ action: 'update', file_path: fp, content: String(content ?? '') });
  pendingActions.value = actions;
  if (choice) setChoice(fp, choice);
}

function countThreeWayConflictBlocks(baseText: string, leftText: string, rightText: string) {
  const baseLines = String(baseText ?? '').split('\n');
  const leftLines = String(leftText ?? '').split('\n');
  const rightLines = String(rightText ?? '').split('\n');
  const leftDiff = buildDiff(baseLines, leftLines);
  const rightDiff = buildDiff(baseLines, rightLines);
  const segments = buildSegments(leftDiff.edits, rightDiff.edits);
  if (!segments.length) return 0;

  let count = 0;
  for (const seg of segments) {
    const baseSeg = baseLines.slice(seg.start, seg.end);
    const leftSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.l);
    const rightSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.r);
    const leftChanged = !arraysEqual(leftSeg, baseSeg);
    const rightChanged = !arraysEqual(rightSeg, baseSeg);
    if (!leftChanged || !rightChanged) continue;
    if (arraysEqual(leftSeg, rightSeg)) continue;
    count += 1;
  }
  return count;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  const ms = Math.max(0, Number(timeoutMs || 0));
  if (!ms) return { ok: true as const, value: await promise };
  let timer: any = null;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`超时：${ms}ms`)), ms);
    });
    const value = await Promise.race([promise, timedOut]);
    return { ok: true as const, value: value as T };
  } catch (e) {
    const msg = String(e || '');
    const isTimeout = msg.includes('超时：') || msg.toLowerCase().includes('timeout');
    return { ok: false as const, error: e, timeout: isTimeout };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPool<T>(items: T[], limit: number, worker: (it: T) => Promise<void>) {
  const max = Math.max(1, Number(limit || 1));
  let idx = 0;
  const executing = new Set<Promise<void>>();
  const enqueue = async () => {
    while (idx < items.length && executing.size < max) {
      const it = items[idx++];
      let p: Promise<void>;
      p = (async () => {
        await worker(it);
      })().finally(() => executing.delete(p));
      executing.add(p);
    }
    if (executing.size) {
      await Promise.race(executing);
      await enqueue();
    }
  };
  await enqueue();
}

type ConflictWorkerAnalyzeReq = { id: number; type: 'analyze'; base: string; left: string; right: string };
type ConflictWorkerAnalyzeRes =
  | { id: number; ok: true; conflictCount: number; merged: string | null; computeMs: number }
  | { id: number; ok: false; error: string };

let conflictWorker: Worker | null = null;
let conflictWorkerLoading: Promise<Worker | null> | null = null;
let conflictWorkerReqSeq = 0;
const conflictWorkerPending = new Map<number, { resolve: (v: ConflictWorkerAnalyzeRes) => void; reject: (e: any) => void }>();
let conflictWorkerLoggedReady = false;

function resetConflictWorker(err?: any) {
  try {
    conflictWorker?.terminate?.();
  } catch { }
  conflictWorker = null;
  conflictWorkerLoading = null;
  for (const [, p] of conflictWorkerPending) {
    try {
      p.reject(err ?? new Error('冲突计算 worker 已重置'));
    } catch { }
  }
  conflictWorkerPending.clear();
}

async function getConflictWorker() {
  if (typeof window === 'undefined') return null;
  if (typeof Worker === 'undefined') return null;
  if (conflictWorker) return conflictWorker;
  if (conflictWorkerLoading) return conflictWorkerLoading;

  conflictWorkerLoading = (async () => {
    try {
      const WorkerCtor = (await import('../workers/conflictWorker?worker')).default as any;
      if (!WorkerCtor) {
        console.error('加载冲突计算 worker 失败：未获取到 Worker 构造器');
        conflictWorker = null;
        return null;
      }
      const w: Worker = new WorkerCtor();
      w.onmessage = (ev: MessageEvent<ConflictWorkerAnalyzeRes>) => {
        const msg = ev.data as any;
        const id = Number(msg?.id || 0);
        const p = conflictWorkerPending.get(id);
        if (!p) return;
        conflictWorkerPending.delete(id);
        p.resolve(msg as ConflictWorkerAnalyzeRes);
      };
      w.onerror = (e) => {
        console.error('冲突计算 worker 出错：', e);
        resetConflictWorker(e);
      };
      conflictWorker = w;
      if (!conflictWorkerLoggedReady) {
        conflictWorkerLoggedReady = true;
        console.log('冲突计算 worker 已启动');
      }
      return w;
    } catch (e) {
      console.error('加载冲突计算 worker 失败：', e);
      conflictWorker = null;
      return null;
    } finally {
      conflictWorkerLoading = null;
    }
  })();

  return conflictWorkerLoading;
}

async function computeConflictAnalysis(baseText: string, leftText: string, rightText: string) {
  const t0 = performance.now();
  const w = await getConflictWorker();
  if (!w) {
    const conflictCount = countThreeWayConflictBlocks(baseText, leftText, rightText);
    const merged = conflictCount === 0 ? computeAutoMergeText(baseText, leftText, rightText) : null;
    const ms = Math.round(performance.now() - t0);
    return { conflictCount, merged, ms, fromWorker: false as const };
  }
  const id = ++conflictWorkerReqSeq;
  const p = new Promise<ConflictWorkerAnalyzeRes>((resolve, reject) => {
    conflictWorkerPending.set(id, { resolve, reject });
  });
  p.catch(() => { });
  let timer: any = null;
  try {
    const req: ConflictWorkerAnalyzeReq = { id, type: 'analyze', base: String(baseText ?? ''), left: String(leftText ?? ''), right: String(rightText ?? '') };
    const size = req.base.length + req.left.length + req.right.length;
    const timeoutMs = Math.max(3000, Math.min(20000, 5000 + Math.floor(size / 20000) * 1000));
    w.postMessage(req);
    const res = await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err: any = new Error(`冲突计算 worker 超时：${timeoutMs}ms`);
          err.__timeout = true;
          reject(err);
        }, timeoutMs);
      }),
    ]);
    const ms = Math.round(performance.now() - t0);
    if ((res as any)?.ok) {
      if (ms > 2000) console.log(`冲突块统计耗时较长（worker）：${ms}ms，字符=${size}`);
      return {
        conflictCount: Number((res as any).conflictCount || 0),
        merged: (res as any).merged ?? null,
        ms,
        fromWorker: true as const
      };
    }
    throw new Error(String((res as any)?.error || '冲突计算失败'));
  } catch (e) {
    const msg = String(e || '');
    const isTimeout = Boolean((e as any)?.__timeout) || msg.includes('超时：') || msg.toLowerCase().includes('timeout');
    if (isTimeout) {
      console.error('冲突计算 worker 超时：', e);
      resetConflictWorker(e);
      const conflictCount = countThreeWayConflictBlocks(baseText, leftText, rightText);
      const merged = conflictCount === 0 ? computeAutoMergeText(baseText, leftText, rightText) : null;
      const ms = Math.round(performance.now() - t0);
      console.log(`冲突计算 worker 超时后已回退主线程：耗时=${ms}ms`);
      return { conflictCount, merged, ms, fromWorker: false as const };
    }
    throw e;
  } finally {
    try {
      if (timer) clearTimeout(timer);
    } catch { }
    conflictWorkerPending.delete(id);
  }
}

async function analyzeAndApplyConflictFiles(rawFiles: any[], reason: string) {
  const scanId = ++conflictCountScanSeq;
  const fetchedAt = Date.now();
  const normalized = normalizeConflictFiles(rawFiles).map((f) => {
    const np = String(f?.new_path || '').trim();
    return { ...(f || {}), new_path: np, conflict_block_state: 'pending', conflict_block_count: (f as any)?.conflict_block_count, __fetchedAt: fetchedAt };
  });

  autoProcessedFiles.value = [];
  zeroConflictFiles.value = [];
  deferListRenderUntilScanDone.value = true;

  conflictCountScan.value = {
    running: Boolean(normalized.length),
    reason: String(reason || ''),
    total: normalized.length,
    done: 0,
    ok: 0,
    error: 0,
    timeout: 0,
    binary: 0,
    skipped: 0,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now()
  };

  if (!normalized.length) {
    allConflictFiles.value = [];
    conflictFiles.value = [];
    selectedPaths.value = [];
    deferListRenderUntilScanDone.value = false;
    return;
  }

  allConflictFiles.value = normalized;
  selectedPaths.value = normalized.map((f: any) => String(f?.new_path || '').trim()).filter(Boolean);
  conflictFiles.value = [];
  console.log(`${String(reason || '开始统计冲突块')}：待统计 ${normalized.length} 个文件`);

  const autoProcessed: Array<{ new_path: string; conflict_block_count: number }> = [];

  const isLocal = localGitEnabled.value;
  const updateScan = (patch?: Partial<ConflictBlockScanState>) => {
    if (scanId !== conflictCountScanSeq) return;
    conflictCountScan.value = {
      ...conflictCountScan.value,
      ...(patch || {}),
      lastUpdatedAt: Date.now()
    };
  };
  let baseCommit: string | null = null;
  if (!isLocal) {
    const baseRes = await withTimeout(
      getMergeBase({ projectId: projectId.value, refs: [source.value, target.value] }) as any,
      12_000
    );
    if (scanId !== conflictCountScanSeq) return;
    if (baseRes.ok) baseCommit = (baseRes.value as any) as any;
    else {
      baseCommit = null;
      addHistory(`获取 merge base 失败：${String((baseRes as any).error || '')}`);
      console.error('获取 merge base 失败：', (baseRes as any).error);
    }
  }

  if (!isLocal && !baseCommit) {
    for (const f of normalized) {
      (f as any).conflict_block_state = 'error';
      if (getKnownConflictBlockCountForPreserve(f) == null) (f as any).conflict_block_count = undefined;
    }
    deferListRenderUntilScanDone.value = false;
    applyUiFiltersNow();
    selectedPaths.value = conflictFiles.value.map((f: any) => String(f?.new_path || '').trim()).filter(Boolean);
    updateScan({ running: false, done: normalized.length, error: normalized.length });
    addHistory(`${reason}：无法获取 merge base，已跳过冲突块统计（保留文件列表）`);
    console.log(`${reason}：无法获取 merge base，已跳过冲突块统计（保留文件列表）`);
    if (props.visible && !currentFile.value && conflictFiles.value.length) {
      pendingOpenFile = conflictFiles.value[0];
      await maybeOpenPendingFile();
    }
    return;
  }

  const fileFetchTimeoutMs = isLocal ? 25_000 : 25_000;
  const concurrency = isLocal ? 2 : 3;

  const removeFromVisible = async (path: string) => {
    const fp = String(path || '').trim();
    if (!fp) return;
    selectedPaths.value = selectedPaths.value.filter((p) => p !== fp);
    const removedCurrent = currentFile.value?.new_path === fp;
    if (removedCurrent) {
      currentFile.value = null;
    }
    applyUiFiltersNow();
    if (removedCurrent && conflictFiles.value.length) {
      pendingOpenFile = conflictFiles.value[currentIndex.value] || conflictFiles.value[0];
      await maybeOpenPendingFile();
    }
  };

  await runPool(normalized, concurrency, async (file) => {
    if (!props.visible) return;
    if (scanId !== conflictCountScanSeq) return;

    const newPath = String((file as any)?.new_path || '').trim();
    const oldPath = String((file as any)?.old_path || '').trim();
    const targetPath = (oldPath || newPath).trim();
    const sourcePath = (newPath || oldPath).trim();
    const basePath = (oldPath || newPath).trim();
    const filePath = sourcePath || targetPath;
    if (!filePath) {
      (file as any).conflict_block_state = 'skipped';
      updateScan({ done: conflictCountScan.value.done + 1, skipped: conflictCountScan.value.skipped + 1 });
      return;
    }

    if (isBinaryCandidate(newPath)) {
      (file as any).conflict_block_state = 'binary';
      if (getKnownConflictBlockCountForPreserve(file) == null) (file as any).conflict_block_count = undefined;
      updateScan({ done: conflictCountScan.value.done + 1, binary: conflictCountScan.value.binary + 1 });
      addHistory(`按扩展名跳过二进制文件统计：${newPath}`);
      return;
    }

    try {
      let targetContent = '';
      let sourceContent = '';
      let baseContent = '';

      if (isLocal) {
        const res = await withTimeout(
          localGitGetFileContents({
            runId: runId.value,
            filePath,
            targetPath,
            sourcePath,
            basePath,
          }) as any,
          fileFetchTimeoutMs
        );
        if (!res.ok) throw Object.assign(new Error('本地读取文件失败'), { __timeout: Boolean((res as any).timeout), __cause: (res as any).error });
        const anyRes = res.value as any;
        if (!anyRes?.ok) throw new Error(String(anyRes?.error || '本地读取文件失败'));
        targetContent = String(anyRes.left ?? '');
        sourceContent = String(anyRes.right ?? '');
        baseContent = String(anyRes.base ?? '');
      } else {
        const getWithFallback = async (ref: string, primary: string, fallback: string) => {
          const primaryRes = await withTimeout(
            getFileContent({ projectId: projectId.value, filePath: primary, ref }) as any,
            fileFetchTimeoutMs
          );
          if (primaryRes.ok) return { ok: true as const, path: primary, content: String(primaryRes.value ?? '') };
          if (!fallback || fallback === primary) return { ok: false as const, path: primary, content: '', error: (primaryRes as any).error, timeout: Boolean((primaryRes as any).timeout) };
          const fallbackRes = await withTimeout(
            getFileContent({ projectId: projectId.value, filePath: fallback, ref }) as any,
            fileFetchTimeoutMs
          );
          if (fallbackRes.ok) return { ok: true as const, path: fallback, content: String(fallbackRes.value ?? '') };
          return { ok: false as const, path: `${primary} -> ${fallback}`, content: '', error: (fallbackRes as any).error, timeout: Boolean((fallbackRes as any).timeout) };
        };

        const [tgtRes, srcRes] = await Promise.all([
          getWithFallback(target.value, targetPath || filePath, sourcePath || filePath),
          getWithFallback(source.value, sourcePath || filePath, targetPath || filePath),
        ]);
        if (!tgtRes.ok || !srcRes.ok) {
          const isTimeout = Boolean((tgtRes as any)?.timeout || (srcRes as any)?.timeout);
          const which = !tgtRes.ok && !srcRes.ok ? '目标/源分支均无法读取' : !tgtRes.ok ? '目标分支无法读取' : '源分支无法读取';
          const err = new Error(`${which}：${filePath}`);
          (err as any).__timeout = isTimeout;
          throw err;
        }

        targetContent = String((tgtRes as any).content ?? '');
        sourceContent = String((srcRes as any).content ?? '');

        if (baseCommit) {
          const baseRes1 = await withTimeout(
            getFileContent({ projectId: projectId.value, filePath: basePath || filePath, ref: baseCommit }) as any,
            fileFetchTimeoutMs
          );
          if (baseRes1.ok) {
            baseContent = String(baseRes1.value ?? '');
          } else {
            const baseRes2 = sourcePath && sourcePath !== (basePath || filePath)
              ? await withTimeout(getFileContent({ projectId: projectId.value, filePath: sourcePath, ref: baseCommit }) as any, fileFetchTimeoutMs)
              : null;
            if (baseRes2?.ok) baseContent = String(baseRes2.value ?? '');
            else baseContent = '';
          }
        }
      }

      if (
        (targetContent && targetContent.includes('\u0000')) ||
        (sourceContent && sourceContent.includes('\u0000')) ||
        (baseContent && baseContent.includes('\u0000'))
      ) {
        (file as any).conflict_block_state = 'binary';
        if (getKnownConflictBlockCountForPreserve(file) == null) (file as any).conflict_block_count = undefined;
        updateScan({ done: conflictCountScan.value.done + 1, binary: conflictCountScan.value.binary + 1 });
        addHistory(`已识别为二进制/不可统计：${newPath}`);
        return;
      }

      const baseLinesCount = String(baseContent ?? '').split('\n').length;
      const targetLinesCount = String(targetContent ?? '').split('\n').length;
      const sourceLinesCount = String(sourceContent ?? '').split('\n').length;
      const totalLines = baseLinesCount + targetLinesCount + sourceLinesCount;
      const maxLinesForCount = 60_000;
      if (totalLines > maxLinesForCount) {
        (file as any).conflict_block_state = 'skipped';
        if (getKnownConflictBlockCountForPreserve(file) == null) (file as any).conflict_block_count = undefined;
        updateScan({ done: conflictCountScan.value.done + 1, skipped: conflictCountScan.value.skipped + 1 });
        addHistory(`已跳过冲突块统计（文件过大）：${newPath}，行数=${totalLines}`);
        console.log(`已跳过冲突块统计（文件过大）：${newPath}，行数=${totalLines}`);
        return;
      }

      const calc = await computeConflictAnalysis(baseContent, targetContent, sourceContent);
      const conflictCount = calc.conflictCount;
      const ms = calc.ms;
      if (conflictCount === 0) {
        const merged = calc.merged ?? computeAutoMergeText(baseContent, targetContent, sourceContent);
        stageUpdateAction(newPath, merged, 'both');
        (file as any).conflict_block_state = 'no_conflict';
        (file as any).conflict_block_count = 0;
        zeroConflictFiles.value.push({ ...(file as any), __filterReason: 'conflict_block_count=0' });
        await removeFromVisible(newPath);
        autoProcessed.push({ new_path: newPath, conflict_block_count: 0 });
        updateScan({ done: conflictCountScan.value.done + 1, ok: conflictCountScan.value.ok + 1 });
        if (ms > 2000) console.log(`冲突块统计耗时较长：${newPath}，${ms}ms`);
        return;
      }

      (file as any).conflict_block_state = 'ok';
      (file as any).conflict_block_count = conflictCount;
      updateScan({ done: conflictCountScan.value.done + 1, ok: conflictCountScan.value.ok + 1 });
      if (ms > 2000) console.log(`冲突块统计耗时较长：${newPath}，${ms}ms`);
    } catch (e) {
      const isTimeout = Boolean((e as any)?.__timeout) || String(e || '').includes('超时：');
      (file as any).conflict_block_state = isTimeout ? 'timeout' : 'error';
      if (getKnownConflictBlockCountForPreserve(file) == null) (file as any).conflict_block_count = undefined;
      if (isTimeout) updateScan({ done: conflictCountScan.value.done + 1, timeout: conflictCountScan.value.timeout + 1 });
      else updateScan({ done: conflictCountScan.value.done + 1, error: conflictCountScan.value.error + 1 });

      addHistory(`冲突块统计失败：${String((file as any)?.new_path || '')}，原因：${String(e)}`);
      console.error('冲突块统计失败：', e);
    }
  });

  if (scanId !== conflictCountScanSeq) {
    for (const f of normalized) {
      const st = String((f as any).conflict_block_state || '');
      if (st === 'pending') {
        (f as any).conflict_block_state = 'skipped';
        if (getKnownConflictBlockCountForPreserve(f) == null) (f as any).conflict_block_count = undefined;
      }
    }
    conflictCountScan.value = {
      ...conflictCountScan.value,
      running: false,
      lastUpdatedAt: Date.now()
    };
    deferListRenderUntilScanDone.value = false;
    return;
  }

  autoProcessedFiles.value = autoProcessed;
  deferListRenderUntilScanDone.value = false;
  applyUiFiltersNow();
  selectedPaths.value = conflictFiles.value.map((f: any) => String(f?.new_path || '').trim()).filter(Boolean);
  updateScan({ running: false });
  addHistory(`${reason}：显示 ${conflictFiles.value.length} 个文件，自动处理 ${autoProcessed.length} 个无冲突文件；失败 ${conflictCountScan.value.error}，超时 ${conflictCountScan.value.timeout}`);
  console.log(`${reason}：显示 ${conflictFiles.value.length} 个文件，自动处理 ${autoProcessed.length} 个无冲突文件；失败 ${conflictCountScan.value.error}，超时 ${conflictCountScan.value.timeout}`);
  if (!showAllFiles.value) {
    const leaked = conflictFiles.value.filter((f: any) => isZeroConflictFile(f));
    if (!leaked.length) console.log('过滤校验通过：列表中不存在冲突块为 0 的文件');
    else console.error(`过滤校验失败：仍存在 ${leaked.length} 个冲突块为 0 的文件`);
  }
  if (props.visible && !currentFile.value && conflictFiles.value.length) {
    pendingOpenFile = conflictFiles.value[0];
    await maybeOpenPendingFile();
  }
}

async function maybeOpenPendingFile() {
  if (!props.visible) return;
  const f = pendingOpenFile;
  if (!f?.new_path) return;
  await nextTick();
  if (!props.visible) return;
  pendingOpenFile = null;
  await loadFileSmart(f);
}

async function fetchConflictList() {
  const iid = Number(props.conflictData?.mrIid || 0);
  if (!iid || !projectId.value) return [];
  if (mrWebUrl.value) {
    const list = await getMergeRequestConflictsFull({
      projectId: projectId.value,
      mrIid: iid,
      mrWebUrl: mrWebUrl.value,
    });
    return Array.isArray(list) ? list : [];
  }
  const list = await getMergeRequestConflicts({ projectId: projectId.value, mrIid: iid });
  return Array.isArray(list) ? list : [];
}

async function filterConflictFilesByConflictForPath(rawFiles: any[], reason: string) {
  const iid = Number(props.conflictData?.mrIid || 0);
  const url = String(mrWebUrl.value || '').trim();
  if (!iid || !url) return Array.isArray(rawFiles) ? rawFiles : [];
  const normalized = normalizeConflictFiles(Array.isArray(rawFiles) ? rawFiles : []);
  if (!normalized.length) return [];

  const kept: any[] = [];
  const removed: string[] = [];
  const concurrency = 4;
  await runPool(normalized, concurrency, async (f) => {
    const newPath = String((f as any)?.new_path || '').trim();
    if (!newPath) return;
    const oldPath = String((f as any)?.old_path || newPath).trim() || newPath;
    try {
      const res = await withTimeout(
        getMergeRequestConflictForPath({
          mrWebUrl: url,
          mrIid: iid,
          oldPath,
          newPath,
        }) as any,
        12_000
      );
      if (!res.ok) {
        kept.push(f);
        return;
      }
      const ids = extractSectionIds((res as any).value);
      if (ids.length) {
        kept.push(f);
      } else {
        removed.push(newPath);
      }
    } catch {
      kept.push(f);
    }
  });

  if (removed.length) {
    addHistory(`${String(reason || '冲突列表校验')}：已自动隐藏无实际冲突文件 ${removed.length} 个`);
    console.log(`${String(reason || '冲突列表校验')}：已自动隐藏无实际冲突文件 ${removed.length} 个：${removed.slice(0, 20).join(', ')}${removed.length > 20 ? '…' : ''}`);
  }

  return kept;
}

function getConflictListCacheKey() {
  const pid = Number(projectId.value || 0);
  const iid = Number(props.conflictData?.mrIid || 0);
  const url = String(mrWebUrl.value || '').trim();
  return `conflicts:v1:${pid}:${iid}:${url}`;
}

function readConflictListCache(): any[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const key = getConflictListCacheKey();
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    const ts = Number(parsed?.ts || 0);
    const ttlMs = 120_000;
    if (!ts || Date.now() - ts > ttlMs) return null;
    const files = parsed?.files;
    return Array.isArray(files) ? files : null;
  } catch {
    return null;
  }
}

function writeConflictListCache(files: any[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return;
    const max = 500;
    if (list.length > max) return;
    const slim = list.map((f: any) => ({
      type: f?.type,
      new_path: f?.new_path,
      old_path: f?.old_path,
      sections: f?.sections,
    }));
    const payload = JSON.stringify({ ts: Date.now(), files: slim });
    if (payload.length > 900_000) return;
    localStorage.setItem(getConflictListCacheKey(), payload);
  } catch { }
}

async function fetchAllConflicts(reason: string) {
  if (conflictListLoading.value) return;
  conflictListLoading.value = true;
  conflictListError.value = '';
  try {
    const cached = readConflictListCache();
    if (cached?.length) {
      addHistory(`冲突列表缓存命中：${cached.length} 个`);
      console.log(`冲突列表缓存命中：${cached.length} 个`);
      const filtered = await filterConflictFilesByConflictForPath(
        cached,
        `${String(reason || '拉取冲突文件列表完成')}（缓存校验）`
      );
      await analyzeAndApplyConflictFiles(filtered, `${String(reason || '拉取冲突文件列表完成')}（缓存）`);
      if (props.visible && !currentFile.value && conflictFiles.value.length) {
        pendingOpenFile = conflictFiles.value[0];
        await maybeOpenPendingFile();
      }
      return;
    }
    const files = await fetchConflictList();
    if (Array.isArray(files) && files.length) {
      addHistory(`已拉取冲突文件列表：${files.length} 个`);
      console.log(`已拉取冲突文件列表：${files.length} 个`);
      const filtered = await filterConflictFilesByConflictForPath(
        files,
        `${String(reason || '拉取冲突文件列表完成')}（校验）`
      );
      writeConflictListCache(filtered);
      await analyzeAndApplyConflictFiles(filtered, reason || '拉取冲突文件列表完成');
      if (props.visible && !currentFile.value && conflictFiles.value.length) {
        pendingOpenFile = conflictFiles.value[0];
        await maybeOpenPendingFile();
      }
      return;
    }
    addHistory('拉取冲突文件列表为空，沿用初始化列表');
    console.log('拉取冲突文件列表为空，沿用初始化列表');
  } catch (e) {
    conflictListError.value = `拉取冲突文件列表失败：${String(e)}`;
    addHistory(conflictListError.value);
    console.error('拉取冲突文件列表失败：', e);
  } finally {
    conflictListLoading.value = false;
  }
}

async function applyConflictData(data: any) {
  projectId.value = data.projectId;
  source.value = data.source;
  target.value = data.target;
  runId.value = data.runId || '';
  if (!runId.value) {
    const pid = Number(data.projectId || 0);
    const iid = Number(data.mrIid || 0);
    runId.value = `mr-${pid}-${iid}-${Date.now()}`;
  }
  mrWebUrl.value = data.mrWebUrl || '';
  currentIndex.value = 0;
  currentFile.value = null;
  fileLoadError.value = '';
  localGitEnabled.value = false;
  localGitError.value = '';
  relatedFiles.value = [];
  relatedFilesError.value = '';
  conflictApiDebug.value = data.conflictApiDebug || null;
  mrDetails.value = data.mrDetails || null;
  emptyRefreshError.value = '';
  emptyMrRefreshError.value = '';
  emptyAutoRefreshed = false;
  localGitAutoTriggered = false;
  relatedAdhocAutoOpened = false;
  gitattributesLoading.value = false;
  gitattributesError.value = '';
  gitattributesTarget.value = '';
  gitattributesSource.value = '';
  pendingActions.value = [];
  fileStates.value = {};
  selectedPaths.value = [];
  autoProcessedFiles.value = [];
  autoResolvedOnceByPath.value = {};
  showAllFiles.value = false;
  autoScanTriggeredForRunId = '';
  opHistory.value = [];
  finalConfirmVisible.value = false;
  diffVisible.value = false;
  lastRecordedResultValue = '';

  let list = Array.isArray(data.conflicts) ? data.conflicts : [];
  void analyzeAndApplyConflictFiles(list, '初始化冲突列表');

  queueMicrotask(() => {
    if (!props.visible) return;
    if (!conflictFiles.value.length) return;
    if (!currentFile.value) pendingOpenFile = conflictFiles.value[0];
    void maybeOpenPendingFile();
  });

  if (data.mrIid) {
    void fetchAllConflicts('拉取冲突文件列表完成');
  }

  if (data.mrIid && pendingActions.value.length === 0) {
    await Promise.all([
      loadRelatedFiles(Number(data.mrIid)),
      loadGitattributes()
    ]);
    const d = mrDetails.value as any;
    const looksConflicted =
      d?.has_conflicts ||
      d?.detailed_merge_status === 'conflicts' ||
      d?.merge_status === 'cannot_be_merged';
    if (!emptyAutoRefreshed && looksConflicted) {
      emptyAutoRefreshed = true;
      await refreshConflictList();
    }

    if (
      looksConflicted &&
      !relatedAdhocAutoOpened &&
      !conflictFiles.value.length &&
      pendingActions.value.length === 0 &&
      relatedFiles.value.length
    ) {
      relatedAdhocAutoOpened = true;
      const candidates = relatedFiles.value.filter((p: string) => !isBinaryCandidate(p));
      const list2 = candidates.length ? candidates : relatedFiles.value.slice();
      const first = String(list2[0] || '').trim();
      if (first) {
        addHistory(`冲突列表为空，使用 MR 变更文件进入三方合并：${list2.length} 个`);
        console.log(`冲突列表为空，使用 MR 变更文件进入三方合并：${list2.length} 个`);
        await openAdhocMerge(first, list2);
      }
    }

    const wantAutoLocalGit = Boolean((data as any)?.autoLocalGitDetect);
    if (
      wantAutoLocalGit &&
      looksConflicted &&
      !localGitAutoTriggered &&
      !conflictFiles.value.length &&
      pendingActions.value.length === 0
    ) {
      localGitAutoTriggered = true;
      setTimeout(() => {
        if (!props.visible) return;
        if (localGitLoading.value) return;
        if (conflictFiles.value.length) return;
        void prepareLocalGitConflicts();
      }, 0);
    }
  }
}

watch(() => props.conflictData, async (data) => {
  if (data) {
    await applyConflictData(data);
  }
}, { immediate: true });

async function autoScanAllConflicts(reason: string) {
  if (!props.visible) return;
  if (conflictCountScan.value.running) return;
  const rid = String(runId.value || '').trim();
  const scanDone = Boolean(conflictCountScan.value.total) && conflictCountScan.value.done >= conflictCountScan.value.total;
  if (rid && autoScanTriggeredForRunId === rid && scanDone) return;

  const iid = Number(props.conflictData?.mrIid || 0);
  if (iid) {
    autoScanTriggeredForRunId = rid;
    await fetchAllConflicts(reason);
    return;
  }

  const list = Array.isArray(allConflictFiles.value) ? allConflictFiles.value : [];
  if (!list.length) return;
  autoScanTriggeredForRunId = rid;
  await analyzeAndApplyConflictFiles(list, reason);
}

watch(() => props.visible, async (v) => {
  if (!v) return;
  console.log('已打开冲突解决界面');
  void autoScanAllConflicts('页面打开自动扫描');
  if (pendingOpenFile) {
    await maybeOpenPendingFile();
    return;
  }
  if (!currentFile.value && conflictFiles.value.length) {
    pendingOpenFile = conflictFiles.value[0];
    await maybeOpenPendingFile();
    return;
  }
  if (
    currentFile.value &&
    (!leftEditor.value || !middleEditor.value || !rightEditor.value)
  ) {
    pendingOpenFile = currentFile.value;
    await maybeOpenPendingFile();
  }
});

watch(compactMode, (isCompact) => {
  if (!props.visible) return;
  if (!isCompact) {
    sidebarDrawerOpen.value = false;
    return;
  }
  if (visiblePane.value !== 'middle') visiblePane.value = 'middle';
});

function addHistory(msg: string) {
  const ts = new Date();
  const hh = String(ts.getHours()).padStart(2, '0');
  const mm = String(ts.getMinutes()).padStart(2, '0');
  const ss = String(ts.getSeconds()).padStart(2, '0');
  opHistory.value.unshift(`[${hh}:${mm}:${ss}] ${msg}`);
  if (opHistory.value.length > 50) opHistory.value = opHistory.value.slice(0, 50);
}

function isResolved(filePath: string) {
  return pendingActions.value.some((a) => a?.file_path === filePath);
}

function setChoice(filePath: string, choice: FileChoice) {
  if (!filePath) return;
  fileChoices.value[filePath] = choice;
}

function openFinalConfirm() {
  if (!String(commitMessage.value || '').trim()) {
    commitMessage.value = buildDefaultCommitMessage();
  }
  finalConfirmVisible.value = true;
}

function choiceLabel(filePath: string) {
  const c = fileChoices.value[filePath];
  if (c === 'local') return '本地';
  if (c === 'remote') return '远程';
  if (c === 'both') return '两者';
  if (c === 'manual') return '手动';
  return '';
}

function selectAll() {
  selectedPaths.value = conflictFiles.value.map((f: any) => f?.new_path).filter((x: any) => typeof x === 'string' && x.trim());
}

function selectNone() {
  selectedPaths.value = [];
}

function selectUnresolved() {
  const all = conflictFiles.value.map((f: any) => f?.new_path).filter((x: any) => typeof x === 'string' && x.trim());
  selectedPaths.value = all.filter((p: string) => !isResolved(p));
}

function getConflictBlockCountValue(file: any): number | null {
  const n = (file as any)?.conflict_block_count;
  if (typeof n === 'number' && n >= 0) return n;
  return null;
}

function findNextPendingFile(afterPath: string) {
  const files = conflictFiles.value;
  if (!files.length) return null;
  const normalizedAfter = String(afterPath || '').trim();
  const startIdx = Math.max(0, files.findIndex((f: any) => String(f?.new_path || '').trim() === normalizedAfter));
  const selectedRaw = Array.isArray(selectedPaths.value) ? selectedPaths.value : [];
  const selected = new Set(selectedRaw.map((p: any) => String(p || '').trim()).filter(Boolean));
  const hasSelection = selected.size > 0;

  for (let step = 1; step <= files.length; step++) {
    const idx = (startIdx + step) % files.length;
    const f = files[idx];
    const p = String(f?.new_path || '').trim();
    if (!p || p === normalizedAfter) continue;
    if (hasSelection && !selected.has(p)) continue;
    if (isResolved(p)) continue;
    return f;
  }
  return null;
}

async function getFileContentWithFallback(ref: string, primary: string, fallback: string) {
  try {
    const v = await getFileContent({ projectId: projectId.value, filePath: primary, ref });
    return { ok: true as const, path: primary, content: String(v ?? '') };
  } catch (e1) {
    if (!fallback || fallback === primary) return { ok: false as const, path: primary, content: '', error: String(e1) };
    try {
      const v2 = await getFileContent({ projectId: projectId.value, filePath: fallback, ref });
      return { ok: true as const, path: fallback, content: String(v2 ?? '') };
    } catch (e2) {
      return { ok: false as const, path: `${primary} -> ${fallback}`, content: '', error: String(e2) };
    }
  }
}

async function fetchThreeWayContentsForFile(file: any) {
  const newPath = String(file?.new_path || '').trim();
  const oldPath = String(file?.old_path || '').trim();
  const targetPath = (oldPath || newPath).trim();
  const sourcePath = (newPath || oldPath).trim();
  const basePath = (oldPath || newPath).trim();
  const filePath = sourcePath || targetPath;
  if (!filePath) return { ok: false as const, error: '文件路径为空，无法加载。' };

  try {
    if (localGitEnabled.value) {
      const res = await localGitGetFileContents({
        runId: runId.value,
        filePath,
        targetPath,
        sourcePath,
        basePath,
      });
      if (!res?.ok) return { ok: false as const, error: String(res?.error || '本地读取文件失败') };
      const baseContent = String(res.base ?? '');
      const left = String(res.left ?? '');
      const right = String(res.right ?? '');
      if (
        (left && left.includes('\u0000')) ||
        (right && right.includes('\u0000')) ||
        (baseContent && baseContent.includes('\u0000'))
      ) {
        return { ok: false as const, error: `疑似二进制或不可处理内容：${filePath}` };
      }
      return { ok: true as const, filePath, base: baseContent, left, right };
    }

    if (!target.value || !source.value) {
      return { ok: false as const, error: `分支信息缺失：source=${String(source.value || '')}, target=${String(target.value || '')}` };
    }

    const [tgtRes, srcRes, baseCommit] = await Promise.all([
      getFileContentWithFallback(target.value, targetPath || filePath, sourcePath || filePath),
      getFileContentWithFallback(source.value, sourcePath || filePath, targetPath || filePath),
      Promise.resolve(getMergeBase({ projectId: projectId.value, refs: [source.value, target.value] })).catch(() => null)
    ]);

    if (!tgtRes.ok && !srcRes.ok) {
      return { ok: false as const, error: `无法加载文件内容（目标分支/源分支均读取失败）：${filePath}` };
    }

    const left = String((tgtRes as any).content ?? '');
    const right = String((srcRes as any).content ?? '');
    let baseContent = '';
    if (baseCommit) {
      try {
        baseContent = await getFileContent({ projectId: projectId.value, filePath: basePath || filePath, ref: baseCommit as any });
      } catch {
        if (sourcePath && sourcePath !== (basePath || filePath)) {
          try {
            baseContent = await getFileContent({ projectId: projectId.value, filePath: sourcePath, ref: baseCommit as any });
          } catch {
            baseContent = '';
          }
        } else {
          baseContent = '';
        }
      }
    }

    if (
      (left && left.includes('\u0000')) ||
      (right && right.includes('\u0000')) ||
      (baseContent && baseContent.includes('\u0000'))
    ) {
      return { ok: false as const, error: `疑似二进制或不可处理内容：${filePath}` };
    }

    return { ok: true as const, filePath, base: String(baseContent ?? ''), left, right };
  } catch (e) {
    return { ok: false as const, error: `加载三方内容失败：${String(e)}` };
  }
}

async function autoSkipZeroConflictFile(file: any) {
  const fp = String(file?.new_path || '').trim();
  if (!fp) return { ok: false as const, error: '文件路径为空，无法处理。' };
  if (isResolved(fp)) return { ok: true as const, skipped: true as const, filePath: fp };

  const three = await fetchThreeWayContentsForFile(file);
  if (!three.ok) return { ok: false as const, error: three.error };
  const merged = computeAutoMergeText(three.base, three.left, three.right);
  stageUpdateAction(fp, merged, 'both');
  (file as any).conflict_block_state = 'no_conflict';
  (file as any).conflict_block_count = 0;
  addHistory(`已自动跳过无冲突文件并暂存：${fp}`);
  return { ok: true as const, skipped: true as const, filePath: fp };
}

async function handleFileClick(file: any) {
  if (loading.value) return;
  const fp = String(file?.new_path || '').trim();
  if (!fp) return;

  const count = getConflictBlockCountValue(file);
  if (count === 0) {
    try {
      currentFile.value = file;
      const res = await autoSkipZeroConflictFile(file);
      if (!res.ok) throw new Error(res.error);
      const token = Number(autoResolveToken.value || 0);
      const expected = String(autoResolveExpectedPath.value || '').trim();
      if (token && expected && expected === fp && !hasAutoResolvedOnce(fp)) {
        logAutoResolve(AUTO_RESOLVE_REASON_ZERO_CONFLICT);
        markAutoResolvedOnce(fp);
        disarmAutoResolve();
      }
      const next = findNextPendingFile(fp);
      if (!next) return;
      const idx = conflictFiles.value.findIndex((f: any) => String(f?.new_path || '').trim() === String(next?.new_path || '').trim());
      if (idx >= 0) currentIndex.value = idx;
      await loadFileSmart(next);
      return;
    } catch (e) {
      const msg = `自动跳过失败：${String(e)}`;
      uiError.value = msg;
      addHistory(msg);
    }
  }

  await openFile(file);
}

async function openFile(file: any) {
  if (!file?.new_path) return;
  const idx = conflictFiles.value.findIndex((f: any) => f?.new_path === file.new_path);
  if (idx >= 0) currentIndex.value = idx;
  await loadFileSmart(file);
}

async function openDiff(file: any) {
  if (!file?.new_path) return;
  if (loading.value) return;

  const newPath = String(file?.new_path || '').trim();
  const oldPath = String(file?.old_path || '').trim();
  const targetPath = (oldPath || newPath).trim();
  const sourcePath = (newPath || oldPath).trim();
  const basePath = (oldPath || newPath).trim();
  const filePath = sourcePath || targetPath;
  if (!filePath) return;

  try {
    let targetContent = '';
    let sourceContent = '';

    if (useMockData.value) {
      const mock = buildMockThreeWayTexts(filePath);
      targetContent = String(mock.left ?? '');
      sourceContent = String(mock.right ?? '');
    } else if (localGitEnabled.value) {
      const res = await localGitGetFileContents({
        runId: runId.value,
        filePath,
        targetPath,
        sourcePath,
        basePath,
      });
      if (!res?.ok) throw new Error(String(res?.error || '本地读取文件失败'));
      targetContent = String(res.left ?? '');
      sourceContent = String(res.right ?? '');
    } else {
      if (!target.value || !source.value) {
        throw new Error(`分支信息缺失：source=${String(source.value || '')}, target=${String(target.value || '')}`);
      }
      const [tgtRes, srcRes] = await Promise.all([
        getFileContentWithFallback(target.value, targetPath || filePath, sourcePath || filePath),
        getFileContentWithFallback(source.value, sourcePath || filePath, targetPath || filePath),
      ]);

      if (!tgtRes.ok && !srcRes.ok) {
        const msg = `无法加载差异内容（目标分支/源分支均读取失败）：${filePath}`;
        uiError.value = msg;
        addHistory(`差异读取失败：target(${target.value}) path=${tgtRes.path} err=${String((tgtRes as any).error || '')}`);
        addHistory(`差异读取失败：source(${source.value}) path=${srcRes.path} err=${String((srcRes as any).error || '')}`);
        return;
      }
      targetContent = String((tgtRes as any).content ?? '');
      sourceContent = String((srcRes as any).content ?? '');
    }

    if (
      (targetContent && targetContent.includes('\u0000')) ||
      (sourceContent && sourceContent.includes('\u0000'))
    ) {
      const msg = `疑似二进制或不可显示内容：${filePath}`;
      uiError.value = msg;
      addHistory(msg);
      return;
    }

    diffFilePath.value = file.new_path;
    diffLeft.value = targetContent;
    diffRight.value = sourceContent;
    diffVisible.value = true;
  } catch (e) {
    const msg = `打开差异失败：${String(e)}`;
    uiError.value = msg;
    addHistory(msg);
  }
}

function closeDiff() {
  diffVisible.value = false;
}

const diffLines = computed(() => {
  const left = (diffLeft.value || '').split('\n');
  const right = (diffRight.value || '').split('\n');
  const max = Math.max(left.length, right.length);
  const lines: Array<{ no: number; left: string; right: string; changed: boolean }> = [];
  const limit = Math.min(max, 600);
  for (let i = 0; i < limit; i++) {
    const l = left[i] ?? '';
    const r = right[i] ?? '';
    lines.push({ no: i + 1, left: l, right: r, changed: l !== r });
  }
  return lines;
});

function ensureFileState(filePath: string) {
  if (!Object.prototype.hasOwnProperty.call(fileStates.value, filePath)) {
    fileStates.value[filePath] = { content: null, undo: [] };
  }
  return fileStates.value[filePath];
}

function getFileKey() {
  return currentFile.value?.new_path || '';
}

function getMiddleModel(): any {
  const ed = middleEditor.value;
  if (!ed?.getModel) return null;
  return ed.getModel() || null;
}

function persistCurrentState() {
  const filePath = getFileKey();
  if (!filePath) return;
  const model = getMiddleModel();
  if (!model?.getValue) return;
  const st = ensureFileState(filePath);
  st.content = model.getValue();
}

function applyResultValue(value: string) {
  const model = getMiddleModel();
  if (!model?.setValue) return;
  suppressResultTracking = true;
  try {
    model.setValue(value);
  } finally {
    suppressResultTracking = false;
  }
  const filePath = getFileKey();
  if (filePath) {
    const st = ensureFileState(filePath);
    st.content = value;
  }
  lastRecordedResultValue = value;
  scheduleUpdateDecorations();
}

function setResultValueWithUndo(value: string) {
  const filePath = getFileKey();
  if (!filePath) return;
  const model = getMiddleModel();
  if (!model?.getValue) return;
  const current = model.getValue();
  if (current === value) return;
  const st = ensureFileState(filePath);
  st.undo.push(current);
  applyResultValue(value);
}

async function loadRelatedFiles(mrIid: number) {
  relatedFilesLoading.value = true;
  relatedFilesError.value = '';
  try {
    const res = await getMergeRequestChanges({ projectId: projectId.value, mrIid });
    const changes = (res as any)?.changes;
    const files = Array.isArray(changes)
      ? changes.map((c: any) => c?.new_path || c?.old_path).filter((x: any) => typeof x === 'string' && x.trim())
      : [];
    relatedFiles.value = files.slice(0, 50);
    if (!relatedFiles.value.length) {
      relatedFilesError.value = '未获取到 MR 变更文件列表（changes 为空）。';
    }
  } catch (e) {
    relatedFiles.value = [];
    relatedFilesError.value = `获取 MR 变更文件列表失败：${String(e)}`;
  } finally {
    relatedFilesLoading.value = false;
  }
}

function isBinaryCandidate(filePath: string) {
  const p = (filePath || '').toLowerCase();
  const binaryExt = [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico',
    'pdf', 'zip', '7z', 'rar', 'gz', 'tar',
    'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav',
    'ttf', 'otf', 'woff', 'woff2',
    'exe', 'dll', 'dylib', 'so',
    'psd', 'ai'
  ];
  const idx = p.lastIndexOf('.');
  if (idx < 0) return false;
  const ext = p.slice(idx + 1);
  return binaryExt.includes(ext);
}

const relatedBinaryCandidates = computed(() => relatedFiles.value.filter(isBinaryCandidate));

async function refreshMrStatus() {
  const iid = Number(props.conflictData?.mrIid || 0);
  if (!iid || !projectId.value) return;
  emptyMrRefreshLoading.value = true;
  emptyMrRefreshError.value = '';
  try {
    const mr = await getMergeRequest({ projectId: projectId.value, mrIid: iid });
    mrDetails.value = mr || null;
    addHistory(`刷新 MR 状态: !${iid}`);
  } catch (e) {
    emptyMrRefreshError.value = `刷新 MR 状态失败：${String(e)}`;
    addHistory(emptyMrRefreshError.value);
  } finally {
    emptyMrRefreshLoading.value = false;
  }
}

async function refreshConflictList() {
  const iid = Number(props.conflictData?.mrIid || 0);
  if (!iid || !projectId.value) return;
  emptyRefreshLoading.value = true;
  emptyRefreshError.value = '';
  try {
    const files = await fetchConflictList();
    const filtered = await filterConflictFilesByConflictForPath(files, '重新拉取冲突列表成功（校验）');
    currentIndex.value = 0;
    await analyzeAndApplyConflictFiles(filtered, '重新拉取冲突列表成功');
    if (conflictFiles.value.length) {
      await loadFileSmart(conflictFiles.value[0]);
    } else {
      addHistory('重新拉取冲突列表结果为空');
    }
  } catch (e) {
    emptyRefreshError.value = `重新拉取冲突列表失败：${String(e)}`;
    addHistory(emptyRefreshError.value);
  } finally {
    emptyRefreshLoading.value = false;
  }
}

async function prepareLocalGitConflicts() {
  if (!projectId.value || !runId.value || !source.value || !target.value) {
    const miss: string[] = [];
    if (!projectId.value) miss.push('projectId');
    if (!runId.value) miss.push('runId');
    if (!source.value) miss.push('source');
    if (!target.value) miss.push('target');
    localGitError.value = `无法开始本地 Git 检测，缺少：${miss.join(', ')}`;
    addHistory(localGitError.value);
    return;
  }
  localGitLoading.value = true;
  localGitError.value = '';
  try {
    const res = await localGitPrepareConflicts({
      runId: runId.value,
      projectId: projectId.value,
      source: source.value,
      target: target.value,
      mrWebUrl: props.conflictData?.mrWebUrl || ''
    });
    if (!res?.ok) {
      localGitEnabled.value = false;
      localGitError.value = String(res?.error || '本地 Git 检测失败');
      addHistory(`本地 Git 检测失败: ${localGitError.value}`);
      return;
    }
    const files = Array.isArray(res?.conflicts) ? res.conflicts : [];
    currentIndex.value = 0;
    localGitEnabled.value = true;
    await analyzeAndApplyConflictFiles(files, '本地 Git 检测完成');
    if (conflictFiles.value.length) {
      await loadFileSmart(conflictFiles.value[0]);
    } else {
      localGitError.value = '本地 Git 未检测到冲突文件（可能已无冲突或属于二进制/大文件冲突）';
    }
  } catch (e) {
    localGitEnabled.value = false;
    localGitError.value = `本地 Git 检测失败：${String(e)}`;
    addHistory(localGitError.value);
  } finally {
    localGitLoading.value = false;
  }
}

async function openAdhocMerge(filePath: string, allFiles?: string[]) {
  const fp = String(filePath || '').trim();
  if (!fp) return;
  const all = Array.isArray(allFiles) && allFiles.length ? allFiles : [fp];
  const seen = new Set<string>();
  const list = all
    .map((p) => String(p || '').trim())
    .filter((p) => Boolean(p) && !seen.has(p) && (seen.add(p), true))
    .map((p) => ({ type: 'text', new_path: p }));

  const pickFirstOpenPath = () => {
    const wanted = String(fp || '').trim();
    if (wanted && !isBinaryCandidate(wanted)) return wanted;
    const alt = list.find((f: any) => f?.new_path && !isBinaryCandidate(String(f.new_path)));
    return String(alt?.new_path || wanted).trim();
  };

  const picked = pickFirstOpenPath();
  const idx = list.findIndex((f: any) => f?.new_path === picked);
  autoProcessedFiles.value = [];
  conflictFiles.value = list.length ? list : [{ type: 'text', new_path: fp }];
  selectedPaths.value = conflictFiles.value.map((f: any) => f?.new_path).filter((x: any) => typeof x === 'string' && x.trim());
  currentIndex.value = idx >= 0 ? idx : 0;
  localGitEnabled.value = false;
  localGitError.value = '';
  fileLoadError.value = '';
  if (picked && picked !== fp) {
    addHistory(`跳过疑似二进制文件，改为打开：${picked}`);
    console.log(`跳过疑似二进制文件，改为打开：${picked}`);
  }
  addHistory(`打开三方合并: ${picked || fp}（列表：${conflictFiles.value.length}）`);
  console.log(`打开三方合并: ${picked || fp}（列表：${conflictFiles.value.length}）`);
  if (picked && isBinaryCandidate(picked)) {
    fileLoadError.value = `疑似二进制/不可三方合并文件：${picked}`;
    addHistory(fileLoadError.value);
    return;
  }
  pendingOpenFile = conflictFiles.value[currentIndex.value] || conflictFiles.value[0];
  await maybeOpenPendingFile();
}

async function applyGitThreeWayMergeToResult() {
  if (gitMergeLoading.value) return;
  const filePath = getFileKey();
  if (!filePath) return;
  const resultModel = getMiddleModel();
  if (!resultModel?.getValue) return;
  gitMergeLoading.value = true;
  gitMergeError.value = '';
  try {
    const res = await localGitMergeFileContents({
      base: baseSnapshot.value || '',
      left: leftSnapshot.value || '',
      right: rightSnapshot.value || '',
      labels: {
        left: `本地版本 (${target.value})`,
        base: '合并基础',
        right: `远程版本 (${source.value})`
      },
      diff3: true
    });
    if (!res?.ok) throw new Error(String(res?.error || 'git merge-file 失败'));
    setResultValueWithUndo(String(res.merged ?? ''));
    const blocks = parseGitConflictMarkers(String(res.merged ?? ''));
    if (res.hasConflicts || blocks.length) {
      addHistory(`Git 三方合并完成（仍有冲突块：${blocks.length}）: ${filePath}`);
    } else {
      addHistory(`Git 三方合并完成（无冲突）: ${filePath}`);
    }
    scheduleUpdateDecorations();
    setChoice(filePath, 'manual');
  } catch (e) {
    gitMergeError.value = `Git 三方合并失败：${String(e)}`;
    addHistory(gitMergeError.value);
  } finally {
    gitMergeLoading.value = false;
  }
}

const conflictApiDebugText = computed(() => {
  try {
    return JSON.stringify(conflictApiDebug.value, null, 2);
  } catch {
    return String(conflictApiDebug.value ?? '');
  }
});

const mrDetailsText = computed(() => {
  const d = mrDetails.value;
  if (!d || typeof d !== 'object') return '';
  const parts: string[] = [];
  if (d.merge_status != null) parts.push(`merge_status=${String(d.merge_status)}`);
  if (d.detailed_merge_status != null) parts.push(`detailed_merge_status=${String(d.detailed_merge_status)}`);
  if (d.has_conflicts != null) parts.push(`has_conflicts=${String(d.has_conflicts)}`);
  if (d.state != null) parts.push(`state=${String(d.state)}`);
  if (d.changes_count != null) parts.push(`changes_count=${String(d.changes_count)}`);
  return parts.join(', ');
});

async function loadGitattributes() {
  gitattributesLoading.value = true;
  gitattributesError.value = '';
  try {
    const filePath = '.gitattributes';
    const [tgt, src] = await Promise.all([
      getFileContent({ projectId: projectId.value, filePath, ref: target.value }).catch(() => ''),
      getFileContent({ projectId: projectId.value, filePath, ref: source.value }).catch(() => '')
    ]);
    gitattributesTarget.value = typeof tgt === 'string' ? tgt.slice(0, 4000) : '';
    gitattributesSource.value = typeof src === 'string' ? src.slice(0, 4000) : '';
  } catch (e) {
    gitattributesTarget.value = '';
    gitattributesSource.value = '';
    gitattributesError.value = `获取 .gitattributes 失败：${String(e)}`;
  } finally {
    gitattributesLoading.value = false;
  }
}

function openMrLink() {
  if (mrWebUrl.value) {
    openExternal(mrWebUrl.value);
  }
}

function detectLanguage(filename: string): string {
  if (filename.endsWith('.ts')) return 'typescript';
  if (filename.endsWith('.js')) return 'javascript';
  if (filename.endsWith('.json')) return 'json';
  if (filename.endsWith('.html')) return 'html';
  if (filename.endsWith('.css')) return 'css';
  if (filename.endsWith('.vue')) return 'html'; // approximate
  return 'plaintext';
}

function buildMockThreeWayTexts(filePath: string) {
  const ext = String(filePath || '').split('.').pop()?.toLowerCase() || '';
  const baseLines: string[] = [];
  const leftLines: string[] = [];
  const rightLines: string[] = [];

  if (ext === 'json') {
    baseLines.push('{', '  "name": "demo",', '  "version": "1.0.0"', '}');
    leftLines.push('{', '  "name": "demo",', '  "version": "1.0.1"', '}');
    rightLines.push('{', '  "name": "demo",', '  "version": "2.0.0"', '}');
  } else {
    baseLines.push('function calc(a, b) {', '  return a + b;', '}', '');
    leftLines.push('function calc(a, b) {', '  return a - b;', '}', '');
    rightLines.push('function calc(a, b) {', '  return a * b;', '}', '');
  }

  baseLines.push('export function demo() {', '  const x = 1;', '  return x;', '}', '');
  leftLines.push('export function demo() {', '  const x = 2;', '  return x;', '}', '');
  rightLines.push('export function demo() {', '  const x = 3;', '  return x;', '}', '');

  return { base: baseLines.join('\n'), left: leftLines.join('\n'), right: rightLines.join('\n') };
}

async function loadFileMock(file: any) {
  persistCurrentState();
  loading.value = true;
  currentFile.value = file;
  fileLoadError.value = '';
  baseSnapshot.value = '';

  try {
    const newPath = String(file?.new_path || '').trim();
    const oldPath = String(file?.old_path || '').trim();
    const targetPath = (oldPath || newPath).trim();
    const sourcePath = (newPath || oldPath).trim();
    const basePath = (oldPath || newPath).trim();
    const filePath = (sourcePath || targetPath).trim();
    if (!filePath) {
      fileLoadError.value = '文件路径为空，无法加载。';
      return { ok: false as const, error: fileLoadError.value };
    }

    const mock = buildMockThreeWayTexts(filePath);
    const analysis = await computeConflictAnalysis(mock.base, mock.left, mock.right);
    const conflictCount = Number(analysis?.conflictCount || 0);

    baseSnapshot.value = mock.base;
    leftSnapshot.value = mock.left;
    rightSnapshot.value = mock.right;

    const m = await loadMonaco();
    if (!m) {
      console.error('Monaco Editor 加载失败');
      fileLoadError.value = '编辑器加载失败：无法加载 Monaco Editor。';
      return { ok: false as const, error: fileLoadError.value };
    }

    const ready = await waitForEditorContainersReady();
    const ok = ready
      ? initEditors(m, filePath, mock.base, mock.left, mock.right, detectLanguage(filePath))
      : false;
    if (!ok) {
      editorInitRetryCount += 1;
      if (editorInitRetryCount <= 3) {
        pendingOpenFile = file;
        queueMicrotask(() => {
          if (!props.visible) return;
          void maybeOpenPendingFile();
        });
        return { ok: false as const, error: '编辑器容器尚未就绪' };
      }
      editorInitRetryCount = 0;
      fileLoadError.value = '编辑器容器尚未就绪，请稍后重试。';
      addHistory(`编辑器容器尚未就绪：${filePath}`);
      return { ok: false as const, error: fileLoadError.value };
    }
    editorInitRetryCount = 0;
    try {
      leftEditor.value?.layout?.();
      middleEditor.value?.layout?.();
      rightEditor.value?.layout?.();
    } catch { }

    return {
      ok: true as const,
      filePath,
      basePath,
      targetPath,
      sourcePath,
      baseSha: 'mock-base',
      base: mock.base,
      left: mock.left,
      right: mock.right,
      conflict_block_count: conflictCount
    };
  } catch (e) {
    fileLoadError.value = `加载文件失败：${String(e)}`;
    console.error('加载文件失败：', e);
    return { ok: false as const, error: fileLoadError.value };
  } finally {
    loading.value = false;
  }
}

async function loadFileSmart(file: any) {
  if (useMockData.value) {
    await loadFileMock(file);
    return;
  }
  await loadFile(file);
}

async function loadFile(file: any) {
  persistCurrentState();
  loading.value = true;
  currentFile.value = file;
  fileLoadError.value = '';
  baseSnapshot.value = '';

  try {
    const newPath = String(file?.new_path || '').trim();
    const oldPath = String(file?.old_path || '').trim();
    const targetPath = (oldPath || newPath).trim();
    const sourcePath = (newPath || oldPath).trim();
    const basePath = (oldPath || newPath).trim();
    const filePath = sourcePath || targetPath;
    if (!filePath) {
      fileLoadError.value = '文件路径为空，无法加载。';
      return;
    }
    let targetContent = '';
    let sourceContent = '';
    let baseCommit: string | null = null;
    if (localGitEnabled.value) {
      const res = await localGitGetFileContents({
        runId: runId.value,
        filePath,
        targetPath,
        sourcePath,
        basePath,
      });
      if (!res?.ok) throw new Error(String(res?.error || '本地读取文件失败'));
      targetContent = String(res.left ?? '');
      sourceContent = String(res.right ?? '');
      baseCommit = (res.baseSha as any) ?? null;
      baseSnapshot.value = String(res.base ?? '');
    } else {
      if (!target.value || !source.value) {
        throw new Error(`分支信息缺失：source=${String(source.value || '')}, target=${String(target.value || '')}`);
      }
      const [tgtRes, srcRes, base] = await Promise.all([
        getFileContentWithFallback(target.value, targetPath || filePath, sourcePath || filePath),
        getFileContentWithFallback(source.value, sourcePath || filePath, targetPath || filePath),
        Promise.resolve(getMergeBase({ projectId: projectId.value, refs: [source.value, target.value] })).catch(() => null)
      ]);
      if (!tgtRes.ok && !srcRes.ok) {
        fileLoadError.value = `无法加载文件内容（目标分支/源分支均读取失败）：${filePath}`;
        addHistory(`文件读取失败：target(${target.value}) path=${tgtRes.path} err=${String((tgtRes as any).error || '')}`);
        addHistory(`文件读取失败：source(${source.value}) path=${srcRes.path} err=${String((srcRes as any).error || '')}`);
        return;
      }
      if (tgtRes.ok && tgtRes.path !== (targetPath || filePath)) {
        addHistory(`目标分支读取路径回退：${targetPath || filePath} -> ${tgtRes.path}`);
      }
      if (srcRes.ok && srcRes.path !== (sourcePath || filePath)) {
        addHistory(`源分支读取路径回退：${sourcePath || filePath} -> ${srcRes.path}`);
      }
      targetContent = String((tgtRes as any).content ?? '');
      sourceContent = String((srcRes as any).content ?? '');
      baseCommit = base as any;
    }

    let baseContent = '';
    if (localGitEnabled.value) {
      baseContent = baseSnapshot.value;
    } else {
      if (baseCommit) {
        try {
          baseContent = await getFileContent({ projectId: projectId.value, filePath: basePath || filePath, ref: baseCommit });
        } catch {
          if (sourcePath && sourcePath !== (basePath || filePath)) {
            try {
              baseContent = await getFileContent({ projectId: projectId.value, filePath: sourcePath, ref: baseCommit });
            } catch {
              baseContent = '';
            }
          } else {
            baseContent = '';
          }
        }
      }
    }
    baseSnapshot.value = baseContent;

    if (
      (targetContent && targetContent.includes('\u0000')) ||
      (sourceContent && sourceContent.includes('\u0000')) ||
      (baseContent && baseContent.includes('\u0000'))
    ) {
      fileLoadError.value = `疑似二进制或不可显示内容：${filePath}`;
      addHistory(fileLoadError.value);
      return;
    }

    leftSnapshot.value = targetContent;
    rightSnapshot.value = sourceContent;

    const m = await loadMonaco();
    if (!m) {
      console.error('Monaco Editor 加载失败');
      fileLoadError.value = '编辑器加载失败：无法加载 Monaco Editor。';
      return;
    }

    const ready = await waitForEditorContainersReady();
    const ok = ready
      ? initEditors(m, filePath, baseContent, targetContent, sourceContent, detectLanguage(filePath))
      : false;
    if (!ok) {
      editorInitRetryCount += 1;
      if (editorInitRetryCount <= 3) {
        pendingOpenFile = file;
        queueMicrotask(() => {
          if (!props.visible) return;
          void maybeOpenPendingFile();
        });
        return;
      }
      editorInitRetryCount = 0;
      fileLoadError.value = '编辑器容器尚未就绪，请稍后重试。';
      addHistory(`编辑器容器尚未就绪：${filePath}`);
      return;
    }
    editorInitRetryCount = 0;
    try {
      leftEditor.value?.layout?.();
      middleEditor.value?.layout?.();
      rightEditor.value?.layout?.();
    } catch { }

  } catch (e) {
    fileLoadError.value = `加载文件失败：${String(e)}`;
    console.error('加载文件失败：', e);
  } finally {
    loading.value = false;
  }
}

function buildDefaultCommitMessage() {
  const iid = Number(props.conflictData?.mrIid || 0);
  const list = conflictFiles.value
    .map((f: any) => String(f?.new_path || '').trim())
    .filter((x: string) => Boolean(x));
  const lines: string[] = [];
  lines.push(`解决合并冲突: ${source.value} -> ${target.value}${iid ? ` (MR !${iid})` : ''}`);
  if (list.length) {
    lines.push('');
    lines.push('冲突文件:');
    for (const p of list) lines.push(`- ${p}`);
  }
  return lines.join('\n');
}

function extractSectionIds(data: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    const s = String(v ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  const tryList = (arr: any) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (it && typeof it === 'object') {
        const anyIt = it as any;
        if (anyIt.id != null) push(anyIt.id);
        if (anyIt.section_id != null) push(anyIt.section_id);
        if (anyIt.sectionId != null) push(anyIt.sectionId);
      } else {
        push(it);
      }
    }
  };
  const d = data as any;
  tryList(d?.sections);
  tryList(d?.conflict_file?.sections);
  tryList(d?.conflictFile?.sections);
  tryList(d?.file?.sections);
  const obj =
    d?.sections && typeof d.sections === 'object' && !Array.isArray(d.sections)
      ? d.sections
      : d?.conflict_file?.sections &&
        typeof d.conflict_file.sections === 'object' &&
        !Array.isArray(d.conflict_file.sections)
        ? d.conflict_file.sections
        : null;
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) push(k);
  }
  return out;
}

function choiceToSectionResolution(choice: FileChoice): 'head' | 'origin' | null {
  if (choice === 'remote') return sourceMapsToHead.value ? 'head' : 'origin';
  if (choice === 'local') return sourceMapsToHead.value ? 'origin' : 'head';
  return null;
}

async function confirmAndResolveConflicts() {
  if (resolveConflictsLoading.value) return;
  const iid = Number(props.conflictData?.mrIid || 0);
  if (!iid || !mrWebUrl.value) {
    alert('无法使用 GitLab 提交：缺少 MR 信息（mrIid 或 mrWebUrl）。');
    return;
  }
  const msg = String(commitMessage.value || '').trim();
  if (!msg) {
    alert('提交说明不能为空。');
    return;
  }
  let gitlabSubmitSucceeded = false;
  try {
    resolveConflictsLoading.value = true;
    const filesPayload: any[] = [];
    for (const f of conflictFiles.value) {
      const newPath = String(f?.new_path || '').trim();
      if (!newPath) continue;
      const oldPath = String(f?.old_path || newPath).trim() || newPath;
      const choice = fileChoices.value[newPath];
      const resolution = choice ? choiceToSectionResolution(choice) : null;
      if (!resolution) {
        alert(`文件未选择“接受本地更改/接受远程更改”，无法使用 GitLab 提交：${newPath}`);
        return;
      }
      const detail = await getMergeRequestConflictForPath({
        mrWebUrl: mrWebUrl.value,
        mrIid: iid,
        oldPath,
        newPath,
      });
      const ids = extractSectionIds(detail);
      if (!ids.length) {
        alert(`未从 conflict_for_path 获取到 sections，无法提交：${newPath}`);
        return;
      }
      const sections: Record<string, 'head' | 'origin'> = {};
      for (const id of ids) sections[id] = resolution;
      filesPayload.push({ old_path: oldPath, new_path: newPath, sections });
    }
    if (!filesPayload.length) {
      alert('未生成任何文件提交数据。');
      return;
    }
    const res = await resolveMergeRequestConflicts({
      mrWebUrl: mrWebUrl.value,
      mrIid: iid,
      commit_message: msg,
      files: filesPayload,
    });
    const ok = Boolean((res as any)?.ok);
    if (!ok) {
      const status = (res as any)?.status;
      const errMsg = (res as any)?.error?.message || (res as any)?.message || '未知错误';
      const data = (res as any)?.data;
      let extra = '';
      try {
        if (data != null) extra = `\n\n响应数据:\n${JSON.stringify(data, null, 2)}`;
      } catch { }
      alert(`GitLab 提交失败: ${status ? `HTTP ${status}` : errMsg}${extra}\n\n本次冲突处理仍保持打开状态，您可以修正后重试，或手动取消本次合并。`);
      return;
    }
    gitlabSubmitSucceeded = true;
    try {
      if (localGitEnabled.value) await localGitCleanup({ runId: runId.value });
    } catch { }
    await resolveConflict({
      runId: runId.value,
      resolution: { resolved: true, commitPushed: true }
    });
    emit('resolved');
    emit('close');
  } catch (e) {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    if (gitlabSubmitSucceeded) {
      alert(`GitLab 已提交成功，但同步主流程状态失败：${msg}\n\n您可以稍后点击“我已在 GitLab 解决”，或关闭后重新进入 MR 检查状态。`);
    } else {
      alert(`GitLab 提交失败: ${msg}\n\n本次冲突处理仍保持打开状态，您可以修正后重试，或手动取消本次合并。`);
    }
  } finally {
    resolveConflictsLoading.value = false;
    finalConfirmVisible.value = false;
  }
}

let modelDisposables: Array<{ dispose: () => void }> = [];
let middleModelDisposable: { dispose: () => void } | null = null;
let scrollDisposables: Array<{ dispose: () => void }> = [];
let mouseDisposables: Array<{ dispose: () => void }> = [];
let syncingScroll = false;
let leftDecorationIds: string[] = [];
let middleDecorationIds: string[] = [];
let rightDecorationIds: string[] = [];
let conflictCandidateLines = new Set<number>();
let conflictBlocks: Array<{
  id: string;
  baseStart: number;
  baseEnd: number;
  middleStart: number;
  middleEnd: number;
  line: number;
  leftLines: string[];
  rightLines: string[];
}> = [];
let conflictBlocksById = new Map<string, (typeof conflictBlocks)[number]>();

let currentLeftModel: any = null;
let currentBaseModel: any = null;
let currentRightModel: any = null;
let currentMiddleModel: any = null;

function getEditors() {
  return {
    left: leftEditor.value,
    middle: middleEditor.value,
    right: rightEditor.value
  };
}

function disposeModels() {
  for (const d of modelDisposables) {
    try {
      d.dispose();
    } catch { }
  }
  modelDisposables = [];
  currentLeftModel = null;
  currentBaseModel = null;
  currentRightModel = null;
  currentMiddleModel = null;
}

function disposePerFileListeners() {
  for (const d of scrollDisposables) {
    try {
      d.dispose();
    } catch { }
  }
  scrollDisposables = [];
  for (const d of mouseDisposables) {
    try {
      d.dispose();
    } catch { }
  }
  mouseDisposables = [];
  middleModelDisposable?.dispose();
  middleModelDisposable = null;
}

function ensureEditors(monaco: any) {
  if (!editorLeftContainer.value || !editorMiddleContainer.value || !editorRightContainer.value) return false;
  if (!leftEditor.value) {
    leftEditor.value = monaco.editor.create(editorLeftContainer.value, {
      readOnly: true,
      theme: 'webstorm-light',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: true,
    });
  }
  if (!middleEditor.value) {
    middleEditor.value = monaco.editor.create(editorMiddleContainer.value, {
      readOnly: false,
      theme: 'webstorm-light',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: true,
    });
  }
  if (!rightEditor.value) {
    rightEditor.value = monaco.editor.create(editorRightContainer.value, {
      readOnly: true,
      theme: 'webstorm-light',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: true,
    });
  }
  return true;
}

async function waitForEditorContainersReady(tries = 12) {
  for (let i = 0; i < tries; i++) {
    await nextTick();
    await Promise.resolve();
    if (editorLeftContainer.value && editorMiddleContainer.value && editorRightContainer.value) return true;
  }
  return false;
}

function syncScroll(from: any, toA: any, toB: any) {
  if (!from?.getScrollTop || !from?.getScrollLeft) return;
  if (!toA?.setScrollTop || !toA?.setScrollLeft) return;
  if (!toB?.setScrollTop || !toB?.setScrollLeft) return;
  if (syncingScroll) return;
  syncingScroll = true;
  try {
    const top = from.getScrollTop();
    const left = from.getScrollLeft();
    toA.setScrollTop(top);
    toA.setScrollLeft(left);
    toB.setScrollTop(top);
    toB.setScrollLeft(left);
  } finally {
    syncingScroll = false;
  }
  updateWebstormOverlay();
}

function initEditors(monaco: any, filePath: string, base: string, lhs: string, rhs: string, language: string) {
  if (!ensureEditors(monaco)) return false;
  activeMonaco = monaco;

  disposePerFileListeners();
  disposeModels();

  const modelLeft = monaco.editor.createModel(lhs, language);
  const modelBase = monaco.editor.createModel(base, language);
  const modelRight = monaco.editor.createModel(rhs, language);
  const st = ensureFileState(filePath);
  const initialMiddle = st.content !== null ? st.content : computeAutoMergeText(base, lhs, rhs);
  const modelMiddle = monaco.editor.createModel(initialMiddle, language);

  modelDisposables.push(modelLeft, modelBase, modelRight, modelMiddle);
  currentLeftModel = modelLeft;
  currentBaseModel = modelBase;
  currentRightModel = modelRight;
  currentMiddleModel = modelMiddle;

  leftEditor.value.setModel(modelLeft);
  middleEditor.value.setModel(modelMiddle);
  rightEditor.value.setModel(modelRight);

  lastRecordedResultValue = initialMiddle;
  st.content = initialMiddle;

  middleModelDisposable = modelMiddle.onDidChangeContent(() => {
    if (suppressResultTracking) return;
    if (changeDebounceTimer) clearTimeout(changeDebounceTimer);
    changeDebounceTimer = setTimeout(() => {
      const latest = modelMiddle.getValue();
      if (latest !== lastRecordedResultValue) {
        const s = ensureFileState(filePath);
        s.undo.push(lastRecordedResultValue);
        s.content = latest;
        lastRecordedResultValue = latest;
      }
      setChoice(filePath, 'manual');
      scheduleUpdateDecorations();
    }, 250);
  });

  scrollDisposables.push(
    leftEditor.value.onDidScrollChange(() => syncScroll(leftEditor.value, middleEditor.value, rightEditor.value)),
    middleEditor.value.onDidScrollChange(() => syncScroll(middleEditor.value, leftEditor.value, rightEditor.value)),
    rightEditor.value.onDidScrollChange(() => syncScroll(rightEditor.value, leftEditor.value, middleEditor.value))
  );

  mouseDisposables.push(
    middleEditor.value.onMouseDown((e: any) => {
      const line = e?.target?.position?.lineNumber;
      const type = e?.target?.type;
      if (!line || typeof line !== 'number') return;
      if (!conflictCandidateLines.has(line)) return;
      if (type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      try {
        middleEditor.value.revealLineInCenter(line);
        middleEditor.value.setPosition({ lineNumber: line, column: 1 });
        middleEditor.value.focus();
      } catch { }
    })
  );

  scheduleUpdateDecorations();
  queueMicrotask(() => {
    try {
      leftEditor.value?.layout?.();
      middleEditor.value?.layout?.();
      rightEditor.value?.layout?.();
    } catch { }
  });
  return true;
}

function scheduleUpdateDecorations() {
  if (decorationDebounceTimer) clearTimeout(decorationDebounceTimer);
  decorationDebounceTimer = setTimeout(() => {
    updateLineDecorations();
  }, 100);
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function modelToLines(model: any, maxLines = 5000): string[] | null {
  const lc = Number(model?.getLineCount?.() ?? 0);
  if (!lc) return [];
  if (lc > maxLines) return null;
  const lines: string[] = [];
  for (let ln = 1; ln <= lc; ln++) {
    lines.push(String(model.getLineContent(ln) ?? ''));
  }
  return lines;
}

type DiffOp = { type: 'equal' | 'insert' | 'delete'; lines: string[] };

function myersDiff(a: string[], b: string[], max = 6000): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n + m > max) return null;
  const cost = n * m;
  if (cost > 220000) return null;

  const dp: number[][] = new Array(n + 1);
  dp[0] = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const row = new Array(m + 1);
    row[0] = 0;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      if (ai === b[j - 1]) row[j] = dp[i - 1][j - 1] + 1;
      else row[j] = dp[i - 1][j] >= row[j - 1] ? dp[i - 1][j] : row[j - 1];
    }
    dp[i] = row;
  }

  const ops: Array<{ t: 'equal' | 'insert' | 'delete'; line: string }> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ t: 'equal', line: a[i - 1] });
      i--;
      j--;
      continue;
    }
    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ t: 'insert', line: b[j - 1] });
      j--;
      continue;
    }
    if (i > 0) {
      ops.push({ t: 'delete', line: a[i - 1] });
      i--;
    }
  }

  ops.reverse();
  const grouped: DiffOp[] = [];
  for (const o of ops) {
    const last = grouped[grouped.length - 1];
    if (last && last.type === o.t) last.lines.push(o.line);
    else grouped.push({ type: o.t, lines: [o.line] });
  }
  return grouped;
}

type DiffEdit = { baseStart: number; baseEnd: number; sideStart: number; sideEnd: number; lines: string[] };
type DiffResult = { edits: DiffEdit[]; baseToSideBoundary: number[] };

function computeAutoMergeText(baseText: string, leftText: string, rightText: string) {
  const baseLines = String(baseText ?? '').split('\n');
  const leftLines = String(leftText ?? '').split('\n');
  const rightLines = String(rightText ?? '').split('\n');
  const leftDiff = buildDiff(baseLines, leftLines);
  const rightDiff = buildDiff(baseLines, rightLines);
  const segs = buildSegments(leftDiff.edits, rightDiff.edits);
  if (!segs.length) return String(baseText ?? '');

  const out: string[] = [];
  let pos = 0;
  for (const seg of segs) {
    if (pos < seg.start) out.push(...baseLines.slice(pos, seg.start));
    const baseSeg = baseLines.slice(seg.start, seg.end);
    const lSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.l);
    const rSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.r);
    if (arraysEqual(lSeg, rSeg)) out.push(...lSeg);
    else if (arraysEqual(lSeg, baseSeg)) out.push(...rSeg);
    else if (arraysEqual(rSeg, baseSeg)) out.push(...lSeg);
    else out.push(...baseSeg);
    pos = seg.end;
  }
  if (pos < baseLines.length) out.push(...baseLines.slice(pos));
  return out.join('\n');
}

function buildDiff(baseLines: string[], sideLines: string[]): DiffResult {
  const ops = myersDiff(baseLines, sideLines) ?? null;
  if (!ops) {
    const baseLen = baseLines.length;
    const sideLen = sideLines.length;
    const min = Math.min(baseLen, sideLen);
    const edits: DiffEdit[] = [];
    const baseToSideBoundary: number[] = new Array(baseLen + 1);
    for (let i = 0; i <= baseLen; i++) baseToSideBoundary[i] = Math.min(i, sideLen);
    for (let i = 0; i < min; i++) {
      if (baseLines[i] !== sideLines[i]) {
        edits.push({ baseStart: i, baseEnd: i + 1, sideStart: i, sideEnd: i + 1, lines: [sideLines[i]] });
      }
    }
    if (sideLen > baseLen) {
      edits.push({ baseStart: baseLen, baseEnd: baseLen, sideStart: baseLen, sideEnd: sideLen, lines: sideLines.slice(baseLen) });
    } else if (baseLen > sideLen) {
      edits.push({ baseStart: sideLen, baseEnd: baseLen, sideStart: sideLen, sideEnd: sideLen, lines: [] });
    }
    return { edits, baseToSideBoundary };
  }

  const edits: DiffEdit[] = [];
  const baseToSideBoundary: number[] = new Array(baseLines.length + 1);
  let i = 0;
  let j = 0;
  baseToSideBoundary[0] = 0;
  let active: DiffEdit | null = null;
  for (const op of ops) {
    if (op.type === 'equal') {
      if (active) {
        edits.push(active);
        active = null;
      }
      for (let idx = 0; idx < op.lines.length; idx++) {
        i++;
        j++;
        baseToSideBoundary[i] = j;
      }
      continue;
    }
    if (!active) active = { baseStart: i, baseEnd: i, sideStart: j, sideEnd: j, lines: [] };
    if (op.type === 'delete') {
      for (let idx = 0; idx < op.lines.length; idx++) {
        i++;
        active.baseEnd = i;
        baseToSideBoundary[i] = j;
      }
    } else if (op.type === 'insert') {
      for (let idx = 0; idx < op.lines.length; idx++) {
        active.lines.push(op.lines[idx]);
        j++;
        active.sideEnd = j;
      }
    }
    active.baseEnd = i;
    active.sideEnd = j;
  }
  if (active) edits.push(active);
  baseToSideBoundary[baseLines.length] = sideLines.length;
  return { edits, baseToSideBoundary };
}

function applyEditsToBaseSegment(baseLines: string[], start: number, end: number, edits: DiffEdit[]): string[] {
  if (start === end) {
    const out: string[] = [];
    for (const e of edits) {
      if (e.baseStart === start && e.baseEnd === start && Array.isArray(e.lines) && e.lines.length) {
        out.push(...e.lines);
      }
    }
    return out;
  }
  const out: string[] = [];
  let pos = start;
  for (const e of edits) {
    const s = Math.max(start, e.baseStart);
    const ee = Math.min(end, e.baseEnd);
    if (e.baseEnd <= start || e.baseStart >= end) continue;
    if (pos < s) out.push(...baseLines.slice(pos, s));
    if (e.baseStart >= start && e.baseEnd <= end) {
      out.push(...e.lines);
      pos = e.baseEnd;
    } else {
      const before = baseLines.slice(s, ee);
      if (before.length) out.push(...before);
      pos = ee;
    }
  }
  if (pos < end) out.push(...baseLines.slice(pos, end));
  return out;
}

function buildSegments(leftEdits: DiffEdit[], rightEdits: DiffEdit[]) {
  let li = 0;
  let ri = 0;
  const segs: Array<{ start: number; end: number; l: DiffEdit[]; r: DiffEdit[] }> = [];
  while (li < leftEdits.length || ri < rightEdits.length) {
    const nextL = li < leftEdits.length ? leftEdits[li].baseStart : Number.POSITIVE_INFINITY;
    const nextR = ri < rightEdits.length ? rightEdits[ri].baseStart : Number.POSITIVE_INFINITY;
    let start = Math.min(nextL, nextR);
    let end = start;
    const l: DiffEdit[] = [];
    const r: DiffEdit[] = [];

    while (li < leftEdits.length && leftEdits[li].baseStart === start) {
      const e = leftEdits[li];
      l.push(e);
      end = Math.max(end, e.baseEnd);
      li++;
    }
    while (ri < rightEdits.length && rightEdits[ri].baseStart === start) {
      const e = rightEdits[ri];
      r.push(e);
      end = Math.max(end, e.baseEnd);
      ri++;
    }

    let changed = true;
    while (changed) {
      changed = false;
      while (li < leftEdits.length) {
        const e = leftEdits[li];
        const isInsert = e.baseStart === e.baseEnd;
        if (e.baseStart < end || (isInsert && e.baseStart === end)) {
          l.push(e);
          end = Math.max(end, e.baseEnd);
          li++;
          changed = true;
        } else break;
      }
      while (ri < rightEdits.length) {
        const e = rightEdits[ri];
        const isInsert = e.baseStart === e.baseEnd;
        if (e.baseStart < end || (isInsert && e.baseStart === end)) {
          r.push(e);
          end = Math.max(end, e.baseEnd);
          ri++;
          changed = true;
        } else break;
      }
    }
    segs.push({ start, end, l, r });
  }
  return segs;
}

function updateLineDecorations() {
  const monaco = activeMonaco;
  if (!monaco) return;
  if (!currentLeftModel || !currentBaseModel || !currentRightModel || !currentMiddleModel) return;
  if (!leftEditor.value?.deltaDecorations) return;
  if (!middleEditor.value?.deltaDecorations) return;
  if (!rightEditor.value?.deltaDecorations) return;

  const baseLines = modelToLines(currentBaseModel);
  const leftLines = modelToLines(currentLeftModel);
  const rightLines = modelToLines(currentRightModel);
  const middleLines = modelToLines(currentMiddleModel);

  conflictCandidateLines = new Set<number>();
  conflictBlocks = [];
  conflictBlocksById = new Map<string, (typeof conflictBlocks)[number]>();

  if (!baseLines || !leftLines || !rightLines || !middleLines) {
    const max = Math.max(
      currentLeftModel.getLineCount?.() ?? 0,
      currentBaseModel.getLineCount?.() ?? 0,
      currentRightModel.getLineCount?.() ?? 0,
      currentMiddleModel.getLineCount?.() ?? 0
    );

    const leftNext: Array<{ range: any; options: any }> = [];
    const middleNext: Array<{ range: any; options: any }> = [];
    const rightNext: Array<{ range: any; options: any }> = [];

    for (let line = 1; line <= max; line++) {
      const baseLine = line <= currentBaseModel.getLineCount() ? currentBaseModel.getLineContent(line) : '';
      const leftLine = line <= currentLeftModel.getLineCount() ? currentLeftModel.getLineContent(line) : '';
      const rightLine = line <= currentRightModel.getLineCount() ? currentRightModel.getLineContent(line) : '';
      const middleLine = line <= currentMiddleModel.getLineCount() ? currentMiddleModel.getLineContent(line) : '';

      if (leftLine !== baseLine) {
        leftNext.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, className: 'conflict-line-local' }
        });
      }
      if (rightLine !== baseLine) {
        rightNext.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, className: 'conflict-line-remote' }
        });
      }
      if (middleLine !== baseLine) {
        middleNext.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, className: 'conflict-line-custom' }
        });
      }

      const isConflictCandidate = leftLine !== baseLine && rightLine !== baseLine && leftLine !== rightLine;
      if (isConflictCandidate) {
        conflictCandidateLines.add(line);
        middleNext.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: {
            isWholeLine: true,
            glyphMarginClassName: 'conflict-glyph'
          }
        });
      }
    }

    leftDecorationIds = leftEditor.value.deltaDecorations(leftDecorationIds, leftNext);
    middleDecorationIds = middleEditor.value.deltaDecorations(middleDecorationIds, middleNext);
    rightDecorationIds = rightEditor.value.deltaDecorations(rightDecorationIds, rightNext);
    updateWebstormOverlay();
    decorationSeq.value += 1;
    return;
  }

  const leftDiff = buildDiff(baseLines, leftLines);
  const rightDiff = buildDiff(baseLines, rightLines);
  const middleDiff = buildDiff(baseLines, middleLines);

  const leftNext: Array<{ range: any; options: any }> = [];
  const middleNext: Array<{ range: any; options: any }> = [];
  const rightNext: Array<{ range: any; options: any }> = [];

  const leftLc = leftLines.length || 1;
  for (const e of leftDiff.edits) {
    if (e.sideEnd > e.sideStart) {
      leftNext.push({
        range: { startLineNumber: e.sideStart + 1, startColumn: 1, endLineNumber: e.sideEnd, endColumn: 1 },
        options: { isWholeLine: true, className: 'conflict-line-local' }
      });
    } else {
      const ln = Math.min(Math.max(1, e.sideStart + 1), leftLc);
      leftNext.push({
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: { isWholeLine: true, className: 'conflict-line-local' }
      });
    }
  }

  const rightLc = rightLines.length || 1;
  for (const e of rightDiff.edits) {
    if (e.sideEnd > e.sideStart) {
      rightNext.push({
        range: { startLineNumber: e.sideStart + 1, startColumn: 1, endLineNumber: e.sideEnd, endColumn: 1 },
        options: { isWholeLine: true, className: 'conflict-line-remote' }
      });
    } else {
      const ln = Math.min(Math.max(1, e.sideStart + 1), rightLc);
      rightNext.push({
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: { isWholeLine: true, className: 'conflict-line-remote' }
      });
    }
  }

  const middleLc = middleLines.length || 1;
  for (const e of middleDiff.edits) {
    if (e.sideEnd > e.sideStart) {
      middleNext.push({
        range: { startLineNumber: e.sideStart + 1, startColumn: 1, endLineNumber: e.sideEnd, endColumn: 1 },
        options: { isWholeLine: true, className: 'conflict-line-custom' }
      });
    } else {
      const ln = Math.min(Math.max(1, e.sideStart + 1), middleLc);
      middleNext.push({
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: { isWholeLine: true, className: 'conflict-line-custom' }
      });
    }
  }

  const segments = buildSegments(leftDiff.edits, rightDiff.edits);
  let idx = 0;
  for (const seg of segments) {
    const baseSeg = baseLines.slice(seg.start, seg.end);
    const leftSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.l);
    const rightSeg = applyEditsToBaseSegment(baseLines, seg.start, seg.end, seg.r);
    const leftChanged = !arraysEqual(leftSeg, baseSeg);
    const rightChanged = !arraysEqual(rightSeg, baseSeg);
    if (!leftChanged || !rightChanged) continue;
    if (arraysEqual(leftSeg, rightSeg)) continue;

    const middleStart = Math.min(Math.max(0, middleDiff.baseToSideBoundary[seg.start] ?? 0), middleLines.length);
    const middleEnd = Math.min(Math.max(0, middleDiff.baseToSideBoundary[seg.end] ?? middleStart), middleLines.length);
    const startLine = Math.min(Math.max(1, middleStart + 1), middleLc);
    const endLine = middleEnd > middleStart ? Math.min(Math.max(1, middleEnd), middleLc) : startLine;
    const currentSeg = middleLines.slice(middleStart, middleEnd);
    const resolved = arraysEqual(currentSeg, leftSeg) || arraysEqual(currentSeg, rightSeg);
    if (resolved) continue;

    const id = `c${seg.start}-${seg.end}-${idx++}`;
    const block = {
      id,
      baseStart: seg.start,
      baseEnd: seg.end,
      middleStart,
      middleEnd,
      line: startLine,
      leftLines: leftSeg,
      rightLines: rightSeg
    };
    conflictBlocks.push(block);
    conflictBlocksById.set(id, block);
    const markEnd = Math.max(startLine, endLine);
    const maxMark = 600;
    for (let ln = startLine; ln <= markEnd && ln < startLine + maxMark; ln++) {
      conflictCandidateLines.add(ln);
      middleNext.push({
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: { isWholeLine: true, glyphMarginClassName: 'conflict-glyph' }
      });
    }
  }

  const markerBlocks = parseGitConflictMarkers(middleLines.join('\n'));
  if (markerBlocks.length) {
    for (let bi = 0; bi < markerBlocks.length; bi++) {
      const b = markerBlocks[bi];
      const startLine = Math.min(Math.max(1, Number(b.startLine || 1)), middleLc);
      const endLine = Math.min(Math.max(startLine, Number(b.endLine || startLine)), middleLc);
      const id = `m${startLine}-${endLine}-${bi}`;
      const block = {
        id,
        baseStart: startLine - 1,
        baseEnd: endLine,
        middleStart: startLine - 1,
        middleEnd: endLine,
        line: startLine,
        leftLines: Array.isArray(b.leftLines) ? b.leftLines : [],
        rightLines: Array.isArray(b.rightLines) ? b.rightLines : []
      };
      conflictBlocks.push(block);
      conflictBlocksById.set(id, block);
      for (let ln = startLine; ln <= endLine; ln++) {
        conflictCandidateLines.add(ln);
        middleNext.push({
          range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
          options: { isWholeLine: true, glyphMarginClassName: 'conflict-glyph' }
        });
      }
    }
  }

  leftDecorationIds = leftEditor.value.deltaDecorations(leftDecorationIds, leftNext);
  middleDecorationIds = middleEditor.value.deltaDecorations(middleDecorationIds, middleNext);
  rightDecorationIds = rightEditor.value.deltaDecorations(rightDecorationIds, rightNext);
  updateWebstormOverlay();
  decorationSeq.value += 1;
}

function updateWebstormOverlay() {
  const ed = middleEditor.value;
  const wrap = editorMiddleWrap.value;
  conflictBlockCount.value = conflictBlocks.length;
  conflictCandidateCount.value = conflictCandidateLines.size;
  if (!ed?.getTopForLineNumber || !ed?.getScrollTop || !wrap) {
    webstormOverlayItems.value = [];
    return;
  }
  const scrollTop = Number(ed.getScrollTop() || 0);
  const height = Number(wrap.clientHeight || 0);
  const viewHeight = height > 0 ? height : Number.POSITIVE_INFINITY;
  const blocks = conflictBlocks.slice().sort((a, b) => a.line - b.line);
  const items: Array<{ id: string; line: number; top: number }> = [];
  for (const b of blocks) {
    const line = b.line;
    let top = 0;
    try {
      top = Number(ed.getTopForLineNumber(line) || 0) - scrollTop;
    } catch {
      continue;
    }
    if (top < -18 || top > viewHeight) continue;
    items.push({ id: b.id, line, top });
    if (items.length >= 120) break;
  }
  webstormOverlayItems.value = items;
}

function applySideToBlock(from: 'left' | 'right', blockId: string) {
  const { middle } = getEditors();
  const toEd = middle;
  if (!toEd?.getModel || !toEd?.executeEdits) return;
  const block = conflictBlocksById.get(String(blockId));
  if (!block) return;

  const filePath = getFileKey();
  if (!filePath) return;
  const resultModel = getMiddleModel();
  if (!resultModel?.getValue || !resultModel?.getLineMaxColumn) return;
  const before = resultModel.getValue();
  const st = ensureFileState(filePath);
  st.undo.push(before);

  const sideLines = from === 'left' ? block.leftLines : block.rightLines;
  const text = sideLines.join('\n');

  suppressResultTracking = true;
  try {
    const startLine = Math.max(1, Number(block.middleStart + 1));
    const endBoundary = Math.max(0, Number(block.middleEnd));
    if (endBoundary <= block.middleStart) {
      toEd.executeEdits('ui', [
        {
          range: { startLineNumber: startLine, startColumn: 1, endLineNumber: startLine, endColumn: 1 },
          text: sideLines.length ? `${text}\n` : '',
          forceMoveMarkers: true
        }
      ]);
    } else {
      const endLine = Math.max(startLine, Math.min(endBoundary, Number(resultModel.getLineCount?.() ?? endBoundary)));
      const maxCol = Number(resultModel.getLineMaxColumn(endLine) || 1);
      toEd.executeEdits('ui', [
        {
          range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: maxCol },
          text,
          forceMoveMarkers: true
        }
      ]);
    }
  } finally {
    suppressResultTracking = false;
  }

  const after = resultModel.getValue();
  st.content = after;
  lastRecordedResultValue = after;
  addHistory(`${from === 'left' ? '应用左侧块' : '应用右侧块'}: ${filePath}#${block.baseStart + 1}-${block.baseEnd}`);
  setChoice(filePath, 'manual');
  scheduleUpdateDecorations();
}

function acceptCurrentBranch() {
  setResultValueWithUndo(leftSnapshot.value || '');
  addHistory(`接受本地更改: ${getFileKey() || 'Unknown'}`);
  const fp = getFileKey();
  if (fp) setChoice(fp, 'local');
}

function acceptTargetBranch() {
  setResultValueWithUndo(rightSnapshot.value || '');
  addHistory(`接受远程更改: ${getFileKey() || 'Unknown'}`);
  const fp = getFileKey();
  if (fp) setChoice(fp, 'remote');
}

function acceptBothBranches() {
  const left = leftSnapshot.value || '';
  const right = rightSnapshot.value || '';
  if (left === right) {
    setResultValueWithUndo(left);
    return;
  }
  setResultValueWithUndo(
    `<<<<<<< 本地版本 (${target.value})\n${left}\n=======\n${right}\n>>>>>>> 远程版本 (${source.value})\n`
  );
  addHistory(`接受两者: ${getFileKey() || 'Unknown'}`);
  const fp = getFileKey();
  if (fp) setChoice(fp, 'both');
}

function undoEdit() {
  const filePath = getFileKey();
  if (!filePath) return;
  const st = fileStates.value[filePath];
  const model = getMiddleModel();
  if (!st || !model?.getValue) return;
  const prev = st.undo.pop();
  if (typeof prev !== 'string') return;
  applyResultValue(prev);
  addHistory(`撤销: ${filePath}`);
  scheduleUpdateDecorations();
}

function replaceCurrentLineFromPanel(from: 'left' | 'right') {
  const { left, right, middle } = getEditors();
  const fromEd = from === 'left' ? left : right;
  const toEd = middle;
  if (!fromEd?.getPosition || !fromEd?.getModel || !toEd?.getPosition || !toEd?.executeEdits) return;
  const toPos = toEd.getPosition();
  if (!toPos) return;
  const lineNumber = toPos.lineNumber;
  const fromModel = fromEd.getModel();
  if (!fromModel?.getLineContent) return;
  const lineText = String(fromModel.getLineContent(lineNumber) ?? '');

  const filePath = getFileKey();
  if (!filePath) return;
  const resultModel = getMiddleModel();
  if (!resultModel?.getValue || !resultModel?.getLineMaxColumn) return;
  const before = resultModel.getValue();
  const st = ensureFileState(filePath);
  st.undo.push(before);
  const range = {
    startLineNumber: lineNumber,
    startColumn: 1,
    endLineNumber: lineNumber,
    endColumn: resultModel.getLineMaxColumn(lineNumber)
  };
  suppressResultTracking = true;
  try {
    toEd.executeEdits('ui', [{ range, text: lineText, forceMoveMarkers: true }]);
  } finally {
    suppressResultTracking = false;
  }
  const after = resultModel.getValue();
  st.content = after;
  lastRecordedResultValue = after;
  addHistory(`${from === 'left' ? '替换为本地行' : '替换为远程行'}: ${filePath}#${lineNumber}`);
  setChoice(filePath, 'manual');
  scheduleUpdateDecorations();
}

function replaceSelectionFromPanel(from: 'left' | 'right') {
  const { left, right, middle } = getEditors();
  const fromEd = from === 'left' ? left : right;
  const toEd = middle;
  if (!fromEd?.getModel || !toEd?.getSelection || !toEd?.executeEdits) return;
  const sel = toEd.getSelection();
  if (!sel) return;
  const startFirst =
    sel.startLineNumber < sel.endLineNumber ||
    (sel.startLineNumber === sel.endLineNumber && sel.startColumn <= sel.endColumn);
  const range = startFirst
    ? sel
    : {
      startLineNumber: sel.endLineNumber,
      startColumn: sel.endColumn,
      endLineNumber: sel.startLineNumber,
      endColumn: sel.startColumn
    };
  const startLine = Math.min(range.startLineNumber, range.endLineNumber);
  const endLine = Math.max(range.startLineNumber, range.endLineNumber);
  const fromModel = fromEd.getModel();
  if (!fromModel?.getLineContent) return;

  const filePath = getFileKey();
  if (!filePath) return;
  const resultModel = getMiddleModel();
  if (!resultModel?.getValue || !resultModel?.getLineMaxColumn) return;
  const before = resultModel.getValue();
  const st = ensureFileState(filePath);
  st.undo.push(before);

  const parts: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    parts.push(String(fromModel.getLineContent(ln) ?? ''));
  }
  const text = parts.join('\n');
  const fullLineRange = {
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: resultModel.getLineMaxColumn(endLine)
  };
  suppressResultTracking = true;
  try {
    toEd.executeEdits('ui', [{ range: fullLineRange, text, forceMoveMarkers: true }]);
  } finally {
    suppressResultTracking = false;
  }
  const after = resultModel.getValue();
  st.content = after;
  lastRecordedResultValue = after;
  addHistory(`${from === 'left' ? '替换为本地选区' : '替换为远程选区'}: ${filePath}#${startLine}-${endLine}`);
  setChoice(filePath, 'manual');
  scheduleUpdateDecorations();
}

function normalizeCommitActions(list: any[]) {
  const rawList = Array.isArray(list) ? (toRaw(list) as any[]) : [];
  const out: any[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const a = toRaw(rawList[i]) as any;
    const action = a?.action;
    const filePath = a?.file_path;
    const content = a?.content;
    if (typeof action !== 'string' || !action.trim()) {
      throw new Error(`提交数据第 ${i + 1} 项 action 非字符串或为空`);
    }
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error(`提交数据第 ${i + 1} 项 file_path 非字符串或为空`);
    }
    if (content != null && typeof content !== 'string') {
      throw new Error(`提交数据第 ${i + 1} 项 content 不是字符串（当前类型: ${typeof content}）`);
    }
    const normalized: any = { action, file_path: filePath };
    if (content != null) normalized.content = content;
    if (a?.previous_path != null) {
      if (typeof a.previous_path !== 'string' || !a.previous_path.trim()) {
        throw new Error(`提交数据第 ${i + 1} 项 previous_path 非字符串或为空`);
      }
      normalized.previous_path = a.previous_path;
    }
    if (a?.last_commit_id != null) {
      if (typeof a.last_commit_id !== 'string' || !a.last_commit_id.trim()) {
        throw new Error(`提交数据第 ${i + 1} 项 last_commit_id 非字符串或为空`);
      }
      normalized.last_commit_id = a.last_commit_id;
    }
    if (a?.encoding != null) normalized.encoding = a.encoding;
    if (a?.execute_filemode != null) normalized.execute_filemode = a.execute_filemode;
    out.push(normalized);
  }
  return out;
}

const fileMetadataCache = new Map<string, Promise<any | null>>();

async function getFileMetadataOnRef(refName: string, filePath: string) {
  const ref = String(refName || '').trim();
  const fp = String(filePath || '').trim();
  if (!ref || !fp || !projectId.value) return null;
  const key = `${projectId.value}::${ref}::${fp}`;
  const cached = fileMetadataCache.get(key);
  if (cached) return await cached;
  const task = (async () => {
    try {
      const meta = await getFileMetadata({
        projectId: projectId.value,
        filePath: fp,
        ref,
      });
      return meta || null;
    } catch {
      return null;
    }
  })();
  fileMetadataCache.set(key, task);
  return await task;
}

async function buildSourceBranchCommitAction(actionLike: any) {
  const raw = toRaw(actionLike) as any;
  const filePath = String(raw?.file_path || '').trim();
  if (!filePath) throw new Error('提交文件路径为空');
  const content = String(raw?.content ?? '');
  const conflictFile = conflictFiles.value.find((f: any) => {
    const newPath = String(f?.new_path || '').trim();
    const oldPath = String(f?.old_path || '').trim();
    return newPath === filePath || oldPath === filePath;
  }) as any;

  const newPath = String(conflictFile?.new_path || filePath).trim() || filePath;
  const oldPath = String(conflictFile?.old_path || newPath).trim() || newPath;

  if (!source.value) {
    return { action: 'update' as const, file_path: newPath, content };
  }

  if (oldPath !== newPath) {
    const [newMeta, oldMeta] = await Promise.all([
      getFileMetadataOnRef(source.value, newPath),
      getFileMetadataOnRef(source.value, oldPath),
    ]);
    const newExists = Boolean(newMeta);
    const oldExists = Boolean(oldMeta);
    if (!newExists && oldExists) {
      addHistory(`检测到源分支仍使用旧路径，提交时将执行重命名：${oldPath} -> ${newPath}`);
      return {
        action: 'move' as const,
        previous_path: oldPath,
        file_path: newPath,
        content,
        last_commit_id: String((oldMeta as any)?.last_commit_id || '').trim() || undefined,
      };
    }
    if (!newExists && !oldExists) {
      addHistory(`检测到源分支不存在目标文件，提交时将创建：${newPath}`);
      return { action: 'create' as const, file_path: newPath, content };
    }
    return {
      action: 'update' as const,
      file_path: newPath,
      content,
      last_commit_id: String((newMeta as any)?.last_commit_id || '').trim() || undefined,
    };
  }

  const meta = await getFileMetadataOnRef(source.value, newPath);
  if (!meta) {
    addHistory(`检测到源分支不存在目标文件，提交时将创建：${newPath}`);
    return { action: 'create' as const, file_path: newPath, content };
  }
  return {
    action: 'update' as const,
    file_path: newPath,
    content,
    last_commit_id: String((meta as any)?.last_commit_id || '').trim() || undefined,
  };
}

async function buildSourceBranchCommitActions(list: any[]) {
  const rawList = Array.isArray(list) ? (toRaw(list) as any[]) : [];
  const built = await Promise.all(rawList.map((item) => buildSourceBranchCommitAction(item)));
  return normalizeCommitActions(built);
}

function ensureCloneableForIpc(value: any, label: string) {
  const sc = (globalThis as any).structuredClone;
  if (typeof sc !== 'function') return;
  try {
    sc(value);
  } catch (e) {
    console.error(`${label} 无法通过 structured clone（可能包含 Proxy/函数/循环引用等）`, e);
    throw e;
  }
}

async function confirmResolvedExternally() {
  try {
    if (localGitEnabled.value) await localGitCleanup({ runId: runId.value });
  } catch { }
  await resolveConflict({
    runId: runId.value,
    resolution: { resolved: true }
  });
  emit('resolved');
  emit('close');
}

async function markResolved() {
  const modelResult = getMiddleModel();
  if (!modelResult?.getValue) return;
  const content = modelResult.getValue();

  try {
    loading.value = true;
    const fp = currentFile.value?.new_path;
    const actions = pendingActions.value.filter((a) => a?.file_path !== fp);
    actions.push({ action: 'update', file_path: fp, content });
    pendingActions.value = actions;
    addHistory(`暂存: ${fp}`);
    if (fp && !fileChoices.value[fp]) setChoice(fp, 'manual');
    scheduleUpdateDecorations();

    const selectable = selectedPaths.value.slice();
    const unresolvedSelected = selectable.filter((p: string) => !isResolved(p));
    if (unresolvedSelected.length) {
      const currentPath = fp;
      const idx = unresolvedSelected.findIndex((p) => p === currentPath);
      const nextPath = idx >= 0 && idx + 1 < unresolvedSelected.length ? unresolvedSelected[idx + 1] : unresolvedSelected[0];
      const nextFile = conflictFiles.value.find((f: any) => f?.new_path === nextPath) || null;
      if (nextFile) {
        currentIndex.value = conflictFiles.value.findIndex((f: any) => f?.new_path === nextPath);
        await loadFileSmart(nextFile);
        return;
      }
    }

    if (!canFinish.value) {
      alert(`仍有未解决的冲突文件：${totalCount.value - resolvedCount.value} 个。请在左侧列表中选择并处理。`);
      return;
    }

    if (canFinish.value) {
      if (!String(commitMessage.value || '').trim()) {
        commitMessage.value = buildDefaultCommitMessage();
      }
      finalConfirmVisible.value = true;
    }
  } catch (e) {
    console.error('提交失败，错误堆栈：', e);
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    alert('提交失败: ' + msg);
  } finally {
    loading.value = false;
  }
}

function unstageCurrentFile() {
  const fp = currentFile.value?.new_path;
  if (!fp) return;
  const before = pendingActions.value.length;
  pendingActions.value = pendingActions.value.filter((a) => a?.file_path !== fp);
  if (pendingActions.value.length !== before) {
    addHistory(`撤销暂存: ${fp}`);
  }
  finalConfirmVisible.value = false;
}

async function confirmAndCommit() {
  if (!canFinish.value) return;
  let commitSuccess = false;
  try {
    loading.value = true;
    const actions = await buildSourceBranchCommitActions(pendingActions.value);
    ensureCloneableForIpc(actions, '提交 actions');

    // 提交冲突解决到源分支
    addHistory(`正在提交 ${actions.length} 个文件的冲突解决到分支 ${source.value}...`);
    await createCommit({
      projectId: projectId.value,
      branch: source.value,
      message: String(commitMessage.value || '').trim() || `Merge conflict resolution for ${source.value} -> ${target.value} (MR !${props.conflictData?.mrIid || ''})`,
      actions
    });
    commitSuccess = true;
    addHistory(`✓ 提交成功，已推送到 ${source.value} 分支`);
    addHistory(`提示：GitLab 正在重新计算 MR 状态，这可能需要 1-2 分钟...`);

    try {
      if (localGitEnabled.value) await localGitCleanup({ runId: runId.value });
    } catch { }

    // 标记冲突已解决，让主进程等待 GitLab 更新 MR 状态
    await resolveConflict({
      runId: runId.value,
      resolution: { resolved: true, commitPushed: true }
    });
    emit('resolved');
    emit('close');
  } catch (e) {
    console.error('提交失败，错误堆栈：', e);
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    if (commitSuccess) {
      alert(`已提交到源分支，但同步主流程状态失败：${msg}\n\n您可以稍后点击“我已在 GitLab 解决”，或关闭后重新进入 MR 检查状态。`);
    } else {
      alert(`提交失败: ${msg}\n\n本次冲突处理仍保持打开状态，您可以修正后重试，或手动取消本次合并。`);
    }
  } finally {
    loading.value = false;
    finalConfirmVisible.value = false;
  }
}

async function cancelMerge() {
  try {
    if (localGitEnabled.value) await localGitCleanup({ runId: runId.value });
  } catch { }
  await resolveConflict({
    runId: runId.value,
    resolution: { resolved: false }
  });
  emit('close');
}

onUnmounted(() => {
  try {
    if (localGitEnabled.value) localGitCleanup({ runId: runId.value });
  } catch { }
  fileMetadataCache.clear();
  resetConflictWorker();
  window.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', onResize, true);
});
</script>

<style lang="scss" scoped>
// Design Tokens
$primary: #1890ff;
$primary-hover: #40a9ff;
$primary-light: #e6f7ff;
$success: #52c41a;
$success-bg: #f6ffed;
$success-border: #b7eb8f;
$warning: #faad14;
$warning-bg: #fffbe6;
$warning-border: #ffe58f;
$error: #ff4d4f;
$error-bg: #fff2f0;
$error-border: #ffccc7;
$text-main: #1f2937;
$text-secondary: #6b7280;
$text-disabled: #9ca3af;
$border-color: #e5e7eb;
$bg-body: #ffffff;
$bg-gray: #f9fafb;
$radius-lg: 12px;
$radius-base: 8px;
$radius-sm: 4px;
$shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
$shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
$shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
$font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
$transition-base: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

// Mixins
@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

@mixin scrollbar {
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 3px;

    &:hover {
      background: #9ca3af;
    }
  }
}

// Global Reset in Scope
* {
  box-sizing: border-box;
}

// Animation
@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(10px);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.conflict-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  @include flex-center;
  padding: 24px;
  z-index: 2000;
  animation: fadeIn 0.2s ease-out;
}

.conflict-dialog {
  width: 100%;
  height: 100%;
  background: $bg-body;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

// Header
.conflict-header {
  padding: 16px 20px;
  border-bottom: 1px solid $border-color;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: $bg-body;
  flex-shrink: 0;

  .conflict-title {
    font-size: 18px;
    font-weight: 600;
    color: $text-main;
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
  }

  .conflict-subtitle {
    font-size: 13px;
    color: $text-secondary;
    font-weight: normal;
  }

  .conflict-header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
}

// Main Body Layout
.conflict-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

// Sidebar
.conflict-sidebar {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid $border-color;
  background: $bg-gray;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;

  &.collapsed {
    width: 0;
    border-right: none;
    overflow: hidden;
  }
}

.conflict-sidebar-header {
  padding: 16px;
  border-bottom: 1px solid $border-color;
  background: $bg-gray;

  .conflict-sidebar-title {
    font-size: 13px;
    font-weight: 600;
    color: $text-main;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .conflict-sidebar-subtitle {
    font-size: 12px;
    color: $text-secondary;
    margin-top: 4px;
  }

  .conflict-sidebar-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
}

.conflict-file-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  @include scrollbar;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conflict-file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  min-height: 56px;
  border-radius: $radius-base;
  border: 1px solid transparent;
  transition: $transition-base;
  cursor: pointer;
  background: transparent;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  &.active {
    background: $primary-light;
    border-color: rgba($primary, 0.2);

    .conflict-file-path {
      color: $primary;
      font-weight: 500;
    }

    .conflict-file-actions {
      button {
        background: rgba(255, 255, 255, 0.8);
        border-color: rgba($primary, 0.3);
      }
    }
  }

  .conflict-file-check {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
      margin: 0;
      cursor: pointer;
      accent-color: $primary;
    }
  }

  .conflict-file-open {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 6px 8px;
    text-align: left;
    cursor: inherit;
    display: flex;
    flex-direction: column;
    gap: 4px;
    outline: none;
    max-width: 100%; // Ensure button doesn't exceed parent
    min-height: 48px;

    :deep(.n-button__content) {
      width: 100%;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    :deep(.n-button__content > *) {
      min-width: 0;
      max-width: 100%;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  }

  .conflict-file-path {
    font-size: 13px;
    color: $text-main;
    font-family: $font-mono;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.6;
    letter-spacing: 0.2px;
    padding: 2px 0;
    display: block;
    min-width: 0;
    width: 100%;
  }

  .conflict-file-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap; // Allow wrapping on very narrow screens

    .conflict-file-status,
    .conflict-file-choice {
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 10px;
      line-height: 1.4;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .conflict-file-status {
      background: $warning-bg;
      color: $warning;
      border: 1px solid $warning-border;

      &.ok {
        background: $success-bg;
        color: $success;
        border-color: $success-border;
      }
    }

    .conflict-file-choice {
      background: $bg-body;
      color: $text-secondary;
      border: 1px solid $border-color;
    }
  }

  .conflict-file-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0; // Prevent buttons from shrinking
    opacity: 0.8; // Slightly dim by default
    transition: opacity 0.2s;

    button {
      background: white;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      border: 1px solid $border-color;
      white-space: nowrap;
      min-width: 64px;
      height: 32px;

      &:hover {
        border-color: $primary;
        color: $primary;
        z-index: 1;
      }
    }
  }

  &:hover .conflict-file-actions {
    opacity: 1;
  }
}

// Operation History
.conflict-history {
  padding: 12px 16px;
  border-top: 1px solid $border-color;
  background: #fafafa;
  max-height: 150px;
  overflow-y: auto;

  .conflict-history-title {
    font-size: 12px;
    font-weight: 600;
    color: $text-secondary;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .conflict-history-list {
    display: flex;
    flex-direction: column;
    gap: 6px;

    .conflict-history-item {
      font-size: 12px;
      color: $text-main;
      line-height: 1.4;
      font-family: $font-mono;
      padding-left: 8px;
      border-left: 2px solid $border-color;

      &:last-child {
        color: $primary;
        border-left-color: $primary;
        font-weight: 500;
      }
    }
  }
}

// Editor Layout
.conflict-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.conflict-editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: $bg-body;
  position: relative;
}

// Merge Panes Header
.merge-panes-header {
  display: flex;
  align-items: center;
  min-height: 40px;
  background: $bg-gray;
  border-bottom: 1px solid $border-color;
  flex-shrink: 0;
  padding: 6px 10px;
  gap: 0;

  .merge-pane-title {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    color: $text-secondary;
    padding: 0 8px;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.3;
    letter-spacing: 0.2px;

    &.middle {
      color: $primary;
    }
  }

  .merge-pane-tab {
    flex: 1;
    height: 100%;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 13px;
    color: $text-secondary;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      color: $text-main;
      background: rgba(0, 0, 0, 0.02);
    }

    &.active {
      color: $primary;
      border-bottom-color: $primary;
      font-weight: 500;
      background: rgba($primary, 0.05);
    }
  }
}

// Editor Host & Panes
.conflict-editor-host {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
  gap: 0;
  padding: 0;
  background: $bg-body;
}

.pane-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  border-right: 1px solid $border-color;
  background: $bg-body;
  overflow: hidden;

  &:last-child {
    border-right: none;
  }

  &.hidden {
    display: none;
  }

  .pane {
    flex: 1;
    width: 100%;
    height: 100%;
  }
}

// WebStorm Style Merge Overlay
.webstorm-merge-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 100;
  overflow: hidden;
}

.webstorm-merge-control {
  position: absolute;
  left: 0;
  right: 0;
  height: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4px;
  pointer-events: none;
  transform: translateY(-50%);

  .webstorm-merge-btn {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: #fff;
    border: 1px solid $border-color;
    color: $text-secondary;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: $shadow-sm;
    transition: none;
    pointer-events: auto;

    &:hover {
      background: #fff;
      color: $text-main;
      border-color: $border-color;
    }
  }
}

.monaco-container {
  flex: 1;
  position: relative;
  overflow: hidden;

  :deep(.monaco-editor) {
    outline: none;
  }
}

// Empty State
.conflict-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: $bg-gray;
  text-align: center;
  overflow-y: auto; // Allow scrolling if content is long

  .conflict-empty-title {
    font-size: 20px;
    font-weight: 600;
    color: $text-main;
    margin: 0 0 12px 0;
  }

  .conflict-empty-subtitle {
    font-size: 14px;
    color: $text-secondary;
    margin-bottom: 24px;
    line-height: 1.6;
    max-width: 600px;
  }

  .conflict-empty-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .conflict-empty-files {
    width: 100%;
    max-width: 600px;
    background: $bg-body;
    border: 1px solid $border-color;
    border-radius: $radius-base;
    text-align: left;
    margin-top: 16px;
    overflow: hidden;

    .conflict-empty-files-title {
      padding: 10px 16px;
      background: $bg-gray;
      border-bottom: 1px solid $border-color;
      font-size: 13px;
      font-weight: 600;
      color: $text-secondary;
    }

    .conflict-empty-files-list {
      padding: 8px 0;

      .conflict-empty-file {
        padding: 6px 16px;
        font-size: 13px;
        color: $text-main;
        font-family: $font-mono;
        word-break: break-all;

        &.pre {
          white-space: pre-wrap;
          font-family: $font-mono;
          background: $bg-gray;
          padding: 8px 16px;
          border-top: 1px solid $border-color;
          border-bottom: 1px solid $border-color;
          margin: 4px 0;
        }

        &.file-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;

          .file-open {
            background: none;
            border: none;
            color: $primary;
            cursor: pointer;
            text-align: left;
            padding: 0;
            font-family: inherit;

            &:hover {
              text-decoration: underline;
            }
          }
        }
      }
    }
  }
}

// Overlay & Diff Dialogs
.conflict-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(2px);
  z-index: 100;
  @include flex-center;

  &.scrollable {
    overflow-y: auto;
    display: block; // Allow flow layout for scrolling

    .conflict-empty {
      min-height: 100%; // Ensure it fills the scrollable area
    }
  }
}

.diff-dialog,
.confirm-dialog {
  width: 90%;
  max-width: 1000px;
  height: 80%;
  background: $bg-body;
  border-radius: $radius-lg;
  box-shadow: $shadow-lg;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid $border-color;
}

// Animation Keyframes for Pop
@keyframes pop {
  from {
    transform: scale(0.95);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}

// Diff Styles
.diff-header,
.confirm-title-bar {
  padding: 16px;
  border-bottom: 1px solid $border-color;
  background: $bg-gray;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .diff-title,
  .confirm-title {
    // Handle confirm title here too if reused
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: $text-main;
  }
}

.diff-body {
  flex: 1;
  display: flex;
  min-height: 0;

  .diff-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-right: 1px solid $border-color;

    &:last-child {
      border-right: none;
    }

    .diff-panel-title {
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 600;
      color: $text-secondary;
      background: $bg-gray;
      border-bottom: 1px solid $border-color;
    }

    .diff-code {
      flex: 1;
      overflow: auto;
      background: $bg-body;
      font-family: $font-mono;
      font-size: 12px;
      padding: 8px 0;

      .diff-line {
        display: flex;
        padding: 0 8px;
        line-height: 1.5;

        &:hover {
          background: rgba(0, 0, 0, 0.02);
        }

        &.changed {
          background: rgba($warning, 0.1);
          border-left: 2px solid $warning;
        }

        .diff-no {
          width: 40px;
          text-align: right;
          color: $text-disabled;
          margin-right: 12px;
          user-select: none;
          flex-shrink: 0;
        }

        .diff-text {
          white-space: pre;
          color: $text-main;
          word-break: break-all;
        }
      }
    }
  }
}

// Confirm Dialog
.confirm-dialog {
  max-width: 600px;
  height: auto;
  max-height: 80vh;

  .confirm-title {
    padding: 20px 24px 0;
    font-size: 18px;
    font-weight: 600;
    color: $text-main;
  }

  .confirm-subtitle {
    padding: 8px 24px 16px;
    font-size: 14px;
    color: $text-secondary;
  }

  .confirm-list {
    flex: 1;
    overflow-y: auto;
    border-top: 1px solid $border-color;
    border-bottom: 1px solid $border-color;

    .confirm-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 12px 24px;
      border-bottom: 1px solid $border-color;
      background: $bg-body;

      &:last-child {
        border-bottom: none;
      }

      .confirm-path {
        font-family: $font-mono;
        font-size: 13px;
        color: $text-main;
        flex: 1 1 auto;
        min-width: 0;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        line-height: 1.6;
        letter-spacing: 0.2px;
        padding: 2px 0;
        margin-right: 12px;
      }

      .confirm-tag {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 10px;
        background: $bg-gray;
        color: $text-secondary;
        border: 1px solid $border-color;
        white-space: nowrap;
        margin-left: 8px;

        &.ok {
          background: $success-bg;
          color: $success;
          border-color: $success-border;
        }
      }
    }
  }

  .confirm-commit {
    padding: 12px 24px;
    border-bottom: 1px solid $border-color;
    background: $bg-body;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .confirm-commit-title {
      font-size: 13px;
      font-weight: 600;
      color: $text-secondary;
    }

    .confirm-commit-textarea {
      width: 100%;
      min-height: 90px;
      resize: vertical;
      font-family: $font-mono;
      font-size: 12px;
      line-height: 1.5;
      border: 1px solid $border-color;
      border-radius: $radius-sm;
      padding: 8px 10px;
      background: $bg-body;
      color: $text-main;
      outline: none;
    }

    .confirm-commit-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: $text-secondary;
      user-select: none;
    }
  }

  .confirm-actions {
    padding: 16px 24px;
    background: $bg-gray;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    flex-shrink: 0;
  }
}

.conflict-footer {
  padding: 12px 20px;
  border-top: 1px solid $border-color;
  display: grid; // 使用 Grid 布局替代 Flex
  grid-template-columns: 1fr; // 单列布局
  gap: 12px; // 上下间距
  background: $bg-body;
}

.conflict-footer-left {
  min-width: 0;
}

.conflict-hint {
  font-size: 12px;
  color: $text-secondary;
  white-space: normal;
  line-height: 1.4;
}

.conflict-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  flex-wrap: wrap; // 允许换行
  justify-content: flex-end; // 默认右对齐

  // 移除之前的滚动相关样式
  overflow-x: visible;
  padding-bottom: 0;

  button {
    flex-shrink: 0;
  }
}

.footer-action-row {
  width: 100%;
  display: flex;

  &.first {
    margin-top: 4px; // Extra separation from previous buttons
  }

  .btn {
    width: 100%;
    justify-content: center;
    padding: 10px 16px;
    height: 40px; // Larger touch area
    font-size: 14px;

    // Ensure consistent visual
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
}

.footer-action-group {
  display: flex;
  gap: 8px;
}

// Button Styles (Scoped)
button {
  cursor: pointer;
  border: none;
  outline: none;
  font-family: inherit;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  font-size: 13px;
  border-radius: $radius-sm;
  transition: $transition-base;
  font-weight: 500;
  gap: 6px;
  user-select: none;

  &.primary {
    background: $primary;
    color: white;
    box-shadow: $shadow-sm;

    &:hover:not(:disabled) {
      background: $primary-hover;
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba($primary, 0.2);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: none;
    }
  }

  &.secondary,
  &.subtle {
    background: white;
    border: 1px solid $border-color;
    color: $text-main;

    &:hover:not(:disabled) {
      border-color: $primary;
      color: $primary;
      background: $primary-light;
    }
  }

  &.small {
    padding: 4px 12px;
    font-size: 12px;
  }

  &.danger {
    background: white;
    border: 1px solid $error-border;
    color: $error;

    &:hover:not(:disabled) {
      background: $error-bg;
      border-color: $error;
    }
  }

  &.tiny {
    padding: 2px 8px;
    font-size: 11px;
    height: 22px;
    line-height: 1;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
  }
}

// Deep Overrides for Monaco
:deep(.conflict-glyph) {
  width: 4px;
  height: 100%;
  background: $primary;
  margin-left: 0;
  border-radius: 0;
}

:deep(.conflict-line-local) {
  background: rgba($primary, 0.1);
}

:deep(.conflict-line-remote) {
  background: rgba($success, 0.1);
}

:deep(.conflict-line-custom) {
  background: rgba($warning, 0.15);
}

// Responsive
@media (max-width: 768px) {
  .conflict-dialog {
    width: 100%;
    height: 100%;
    border-radius: 0;
    max-height: none;
    border: none;
  }

  .conflict-body {
    flex-direction: column;
  }

  .conflict-sidebar {
    width: 100%;
    height: 200px;
    border-right: none;
    border-bottom: 1px solid $border-color;

    &.collapsed {
      height: 0;
    }
  }

  .conflict-header {
    padding: 12px 16px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    .conflict-header-actions {
      width: 100%;
      overflow-x: auto;
      padding-bottom: 4px;
    }
  }

  .conflict-footer {
    padding: 12px 16px;
    gap: 12px;
  }

  .conflict-footer-actions {
    width: 100%;
    justify-content: flex-start; // 小屏幕左对齐更自然
  }
}
</style>
