<template>
  <div v-if="visible" class="conflict-modal">
    <div class="conflict-dialog">
      <div class="conflict-header">
        <div>
          <h2 class="conflict-title">解决冲突: {{ currentFile?.new_path || 'Unknown File' }}</h2>
          <div class="conflict-subtitle">
            合并: {{ source }} (Incoming) -> {{ target }} (Current)
          </div>
        </div>
        <div class="conflict-header-actions">
          <button v-if="conflictFiles.length && compactMode" class="btn subtle small" :disabled="loading"
            @click="toggleSidebarDrawer">{{ sidebarDrawerOpen ? '收起文件列表' : '打开文件列表' }}</button>
          <a v-if="mrWebUrl" href="#" @click.prevent="openMrLink" class="conflict-link">
            查看 MR !{{ conflictData?.mrIid }}
          </a>
          <button class="btn subtle small" :disabled="loading || conflictCandidateCount === 0"
            @click="jumpConflict(-1)">上一个冲突</button>
          <button class="btn subtle small" :disabled="loading || conflictCandidateCount === 0"
            @click="jumpConflict(1)">下一个冲突</button>
          <span class="conflict-progress">已解决: {{ resolvedCount }} / {{ totalCount }}</span>
          <span v-if="pendingActionsCount" class="conflict-progress">已暂存: {{ pendingActionsCount }}</span>
          <span class="conflict-progress">
            进度: {{ progressCurrent }} / {{ conflictFiles.length }}
          </span>
          <span v-if="conflictBlockCount" class="conflict-progress">冲突块: {{ conflictBlockCount }}</span>
        </div>
      </div>

      <div class="conflict-editor">
        <div class="conflict-body">
          <div v-if="conflictFiles.length && compactMode && sidebarDrawerOpen" class="sidebar-mask"
            @click="sidebarDrawerOpen = false"></div>
          <div v-if="conflictFiles.length" class="conflict-sidebar"
            :class="{ drawer: compactMode, open: sidebarDrawerOpen }">
            <div class="conflict-sidebar-header">
              <div class="conflict-sidebar-title">冲突文件</div>
              <div class="conflict-sidebar-subtitle">已选择: {{ selectedCount }} / {{ conflictFiles.length }}</div>
              <div class="conflict-sidebar-actions">
                <button class="btn subtle small" :disabled="loading" @click="selectAll">全选</button>
                <button class="btn subtle small" :disabled="loading" @click="selectNone">全不选</button>
                <button class="btn subtle small" :disabled="loading" @click="selectUnresolved">仅选未解决</button>
              </div>
            </div>
            <div class="conflict-file-list">
              <div v-for="f in conflictFiles" :key="f.new_path" class="conflict-file-row"
                :class="{ active: f.new_path === currentFile?.new_path }">
                <label class="conflict-file-check">
                  <input type="checkbox" :disabled="loading" :value="f.new_path" v-model="selectedPaths" />
                </label>
                <button class="conflict-file-open" :disabled="loading" @click="openFile(f)">
                  <span class="conflict-file-path" :title="f.new_path">{{ f.new_path }}</span>
                  <span class="conflict-file-status" :class="{ ok: isResolved(f.new_path) }">
                    {{ isResolved(f.new_path) ? '已解决' : '未解决' }}
                  </span>
                  <span v-if="choiceLabel(f.new_path)" class="conflict-file-choice">
                    {{ choiceLabel(f.new_path) }}
                  </span>
                </button>
                <div class="conflict-file-actions">
                  <button class="btn subtle tiny" :disabled="loading" @click="openDiff(f)">差异</button>
                  <button class="btn subtle tiny" :disabled="loading" @click="applyChoiceToFile(f, 'local')">本地</button>
                  <button class="btn subtle tiny" :disabled="loading"
                    @click="applyChoiceToFile(f, 'remote')">远程</button>
                  <button class="btn subtle tiny" :disabled="loading"
                    @click="applyChoiceToFile(f, 'manual')">编辑</button>
                </div>
              </div>
            </div>
            <div v-if="opHistory.length" class="conflict-history">
              <div class="conflict-history-title">操作记录</div>
              <div class="conflict-history-list">
                <div v-for="(h, idx) in opHistory" :key="idx" class="conflict-history-item">{{ h }}</div>
              </div>
            </div>
          </div>

          <div class="conflict-editor-main">
            <div v-if="conflictFiles.length" class="merge-panes-header">
              <template v-if="compactMode">
                <button class="merge-pane-tab" :class="{ active: visiblePane === 'left' }"
                  @click="setVisiblePane('left')">
                  本地（{{ target }}）
                </button>
                <button class="merge-pane-tab middle" :class="{ active: visiblePane === 'middle' }"
                  @click="setVisiblePane('middle')">
                  结果（可编辑）
                </button>
                <button class="merge-pane-tab" :class="{ active: visiblePane === 'right' }"
                  @click="setVisiblePane('right')">
                  远程（{{ source }}）
                </button>
              </template>
              <template v-else>
                <div class="merge-pane-title">本地版本（{{ target }}）</div>
                <div class="merge-pane-title middle">合并基础（可编辑）</div>
                <div class="merge-pane-title">远程版本（{{ source }}）</div>
              </template>
            </div>
            <div class="conflict-editor-host">
              <div class="pane-wrap" :class="{ hidden: compactMode && visiblePane !== 'left' }">
                <div ref="editorLeftContainer" class="pane"></div>
              </div>
              <div ref="editorMiddleWrap" class="pane-wrap middle"
                :class="{ hidden: compactMode && visiblePane !== 'middle' }">
                <div ref="editorMiddleContainer" class="pane"></div>
                <div v-if="webstormOverlayItems.length" class="webstorm-merge-overlay">
                  <div v-for="it in webstormOverlayItems" :key="it.id" class="webstorm-merge-control"
                    :style="{ top: it.top + 'px' }">
                    <button class="webstorm-merge-btn" @click="applySideToBlock('left', it.id)">«</button>
                    <button class="webstorm-merge-btn" @click="applySideToBlock('right', it.id)">»</button>
                  </div>
                </div>
              </div>
              <div class="pane-wrap" :class="{ hidden: compactMode && visiblePane !== 'right' }">
                <div ref="editorRightContainer" class="pane"></div>
              </div>
            </div>
            <div v-if="loading" class="conflict-overlay">
              <span class="conflict-overlay-text">加载文件内容中...</span>
            </div>
            <div v-else-if="fileLoadError" class="conflict-overlay">
              <div class="conflict-empty">
                <p class="conflict-empty-title">文件加载失败</p>
                <p class="conflict-empty-subtitle">{{ fileLoadError }}</p>
              </div>
            </div>
            <div v-else-if="conflictFiles.length === 0" class="conflict-overlay scrollable">
              <div class="conflict-empty">
                <p class="conflict-empty-title">未找到冲突文件</p>
                <p class="conflict-empty-subtitle">GitLab API 返回的冲突列表为空。可能是二进制文件冲突或已被其他操作解决。</p>
                <div class="conflict-empty-actions">
                  <button class="btn subtle small" :disabled="loading || emptyRefreshLoading"
                    @click="refreshConflictList">
                    {{ emptyRefreshLoading ? '拉取中...' : '重新拉取冲突列表' }}
                  </button>
                  <button class="btn subtle small" :disabled="loading || emptyMrRefreshLoading"
                    @click="refreshMrStatus">
                    {{ emptyMrRefreshLoading ? '刷新中...' : '刷新 MR 状态' }}
                  </button>
                  <button class="btn subtle small" :disabled="loading || localGitLoading"
                    @click="prepareLocalGitConflicts">
                    {{ localGitLoading ? '本地检测中...' : '使用本地 Git 检测冲突' }}
                  </button>
                </div>
                <p v-if="emptyRefreshError" class="conflict-empty-subtitle">{{ emptyRefreshError }}</p>
                <p v-if="emptyMrRefreshError" class="conflict-empty-subtitle">{{ emptyMrRefreshError }}</p>
                <p v-if="localGitError" class="conflict-empty-subtitle">{{ localGitError }}</p>
                <div v-if="emptyStateAnalysis.length" class="conflict-empty-files">
                  <div class="conflict-empty-files-title">可能原因与建议</div>
                  <div class="conflict-empty-files-list">
                    <div v-for="(t, idx) in emptyStateAnalysis" :key="'a' + idx" class="conflict-empty-file">{{ t }}
                    </div>
                    <div class="conflict-empty-file">建议操作：1) 点击“重新拉取冲突列表”；2) 若 MR 状态已不冲突，点击“我已在 GitLab 解决”继续检测；3)
                      若持续为空且提示权限异常，请更换有权限的 Token。</div>
                  </div>
                </div>
                <p v-if="relatedFilesLoading" class="conflict-empty-subtitle">正在获取 MR 变更文件列表...</p>
                <p v-else-if="relatedFilesError" class="conflict-empty-subtitle">{{ relatedFilesError }}</p>
                <div v-else-if="relatedFiles.length" class="conflict-empty-files">
                  <div class="conflict-empty-files-title">MR 变更文件（供排查）</div>
                  <div class="conflict-empty-files-list">
                    <div v-for="(f, idx) in relatedFiles" :key="idx" class="conflict-empty-file file-row">
                      <button class="file-open" :disabled="loading" @click="openAdhocMerge(f)">{{ f }}</button>
                      <button class="btn subtle tiny" :disabled="loading" @click="openAdhocMerge(f)">三方合并</button>
                    </div>
                  </div>
                  <div v-if="relatedBinaryCandidates.length" class="conflict-empty-files">
                    <div class="conflict-empty-files-title">疑似二进制/不可三方合并文件（按扩展名推断）</div>
                    <div class="conflict-empty-files-list">
                      <div v-for="(f, idx) in relatedBinaryCandidates" :key="idx" class="conflict-empty-file">{{ f }}
                      </div>
                    </div>
                  </div>
                </div>
                <p v-if="gitattributesLoading" class="conflict-empty-subtitle">正在获取 .gitattributes ...</p>
                <p v-else-if="gitattributesError" class="conflict-empty-subtitle">{{ gitattributesError }}</p>
                <div v-else-if="gitattributesSource || gitattributesTarget" class="conflict-empty-files">
                  <div class="conflict-empty-files-title">.gitattributes（供排查）</div>
                  <div class="conflict-empty-files-list">
                    <div class="conflict-empty-file">目标分支({{ target }}):</div>
                    <div v-if="gitattributesTarget" class="conflict-empty-file pre">{{ gitattributesTarget }}</div>
                    <div v-else class="conflict-empty-file pre">（不存在或无权限读取）</div>
                    <div class="conflict-empty-file" style="margin-top: 10px;">源分支({{ source }}):</div>
                    <div v-if="gitattributesSource" class="conflict-empty-file pre">{{ gitattributesSource }}</div>
                    <div v-else class="conflict-empty-file pre">（不存在或无权限读取）</div>
                  </div>
                </div>
                <div v-if="conflictApiDebug" class="conflict-empty-files">
                  <div class="conflict-empty-files-title">冲突接口诊断（脱敏）</div>
                  <div class="conflict-empty-files-list">
                    <div class="conflict-empty-file pre">{{ conflictApiDebugText }}</div>
                  </div>
                </div>
                <div v-if="mrDetailsText" class="conflict-empty-files">
                  <div class="conflict-empty-files-title">MR 合并状态（供排查）</div>
                  <div class="conflict-empty-files-list">
                    <div class="conflict-empty-file pre">{{ mrDetailsText }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="conflict-footer">
        <div class="conflict-footer-left">
          <span class="conflict-hint">左侧: 本地版本 ({{ target }})，中间: 合并结果，右侧: 远程版本 ({{ source }})。Tab 切换面板，Cmd/Ctrl+Enter
            暂存并前进，Cmd/Ctrl+1/2 替换结果当前行为本地/远程，Cmd/Ctrl+Shift+1/2 替换结果选区为本地/远程，Cmd/Ctrl+Alt+1/2 插入本地/远程当前行。</span>
        </div>
        <div class="conflict-footer-actions">
          <template v-if="conflictFiles.length === 0">
            <button class="btn danger" :disabled="loading" @click="cancelMerge">取消合并</button>
            <button class="btn primary" :disabled="loading" @click="confirmResolvedExternally">我已在 GitLab
              解决，继续检测</button>
          </template>
          <template v-else>
            <button class="btn subtle" :disabled="loading" @click="acceptCurrentBranch">接受本地更改</button>
            <button class="btn subtle" :disabled="loading" @click="acceptTargetBranch">接受远程更改</button>
            <button class="btn subtle" :disabled="loading" @click="acceptBothBranches">接受两者</button>
            <button class="btn subtle" :disabled="loading || gitMergeLoading" @click="applyGitThreeWayMergeToResult">
              {{ gitMergeLoading ? 'Git 合并中...' : 'Git 三方合并' }}
            </button>
            <button class="btn subtle" :disabled="loading" @click="insertLocalLineToResult">插入本地当前行</button>
            <button class="btn subtle" :disabled="loading" @click="insertRemoteLineToResult">插入远程当前行</button>
            <button class="btn subtle" :disabled="loading" @click="copyLocalSelectionToResult">复制本地选中到结果</button>
            <button class="btn subtle" :disabled="loading" @click="copyRemoteSelectionToResult">复制远程选中到结果</button>
            <button class="btn subtle" :disabled="loading" @click="undoEdit">撤销</button>
            <button class="btn subtle" :disabled="loading" @click="redoEdit">重做</button>
            <button class="btn subtle" :disabled="loading || !isResolved(currentFile?.new_path)"
              @click="unstageCurrentFile">撤销暂存</button>
            <button class="btn danger" :disabled="loading" @click="cancelMerge">取消合并</button>
            <button class="btn primary" :disabled="loading" @click="markResolved">
              {{ isAllResolved ? '完成合并' : '下一个文件' }}
            </button>
          </template>
        </div>
      </div>

      <div v-if="diffVisible" class="conflict-overlay">
        <div class="diff-dialog">
          <div class="diff-header">
            <div class="diff-title">查看差异: {{ diffFilePath }}</div>
            <button class="btn subtle" @click="closeDiff">关闭</button>
          </div>
          <div class="diff-body">
            <div class="diff-panel">
              <div class="diff-panel-title">本地版本 ({{ target }})</div>
              <div class="diff-code">
                <div v-for="l in diffLines" :key="'l' + l.no" class="diff-line" :class="{ changed: l.changed }">
                  <span class="diff-no">{{ l.no }}</span>
                  <span class="diff-text">{{ l.left }}</span>
                </div>
              </div>
            </div>
            <div class="diff-panel">
              <div class="diff-panel-title">远程版本 ({{ source }})</div>
              <div class="diff-code">
                <div v-for="l in diffLines" :key="'r' + l.no" class="diff-line" :class="{ changed: l.changed }">
                  <span class="diff-no">{{ l.no }}</span>
                  <span class="diff-text">{{ l.right }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="finalConfirmVisible" class="conflict-overlay">
        <div class="confirm-dialog">
          <div class="confirm-title">最终确认</div>
          <div class="confirm-subtitle">将对以下文件提交合并结果到源分支，并标记冲突已解决。</div>
          <div class="confirm-list">
            <div v-for="f in conflictFiles" :key="f.new_path" class="confirm-item">
              <span class="confirm-path">{{ f.new_path }}</span>
              <span class="confirm-tag" :class="{ ok: isResolved(f.new_path) }">{{ isResolved(f.new_path) ? '已暂存' :
                '未暂存'
                }}</span>
              <span class="confirm-tag">{{ choiceLabel(f.new_path) || '未选择' }}</span>
            </div>
          </div>
          <div class="confirm-actions">
            <button class="btn subtle" :disabled="loading" @click="finalConfirmVisible = false">返回继续编辑</button>
            <button class="btn primary" :disabled="loading || !canFinish" @click="confirmAndCommit">确认合并并提交</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onUnmounted, onMounted } from 'vue';
import { getFileContent, createCommit, resolveConflict, openExternal, getMergeBase, getMergeRequestChanges, getMergeRequestConflicts, getMergeRequest, localGitPrepareConflicts, localGitGetFileContents, localGitMergeFileContents, localGitCleanup } from '../ipc/bridge';
import { parseGitConflictMarkers } from '../utils/conflictMarkers';

// Ensure styles are loaded
import 'monaco-editor/min/vs/editor/editor.main.css';

const props = defineProps<{
  visible: boolean;
  conflictData: any;
}>();

const emit = defineEmits(['close', 'resolved']);

const editorLeftContainer = ref<HTMLElement>();
const editorMiddleContainer = ref<HTMLElement>();
const editorRightContainer = ref<HTMLElement>();
const editorMiddleWrap = ref<HTMLElement>();

const leftEditor = shallowRef<any>();
const middleEditor = shallowRef<any>();
const rightEditor = shallowRef<any>();
let activeMonaco: any = null;

const viewportWidth = ref(0);
const compactMode = computed(() => viewportWidth.value > 0 && viewportWidth.value <= 980);
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
      console.error('Failed to load Monaco Editor', e);
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
  if (mod && e.altKey && (e.key === '1' || e.key === '2')) {
    e.preventDefault();
    if (e.key === '1') insertLocalLineToResult();
    else insertRemoteLineToResult();
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
const currentIndex = ref(0);
const conflictFiles = ref<any[]>([]);
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
const fileStates = ref<Record<string, { content: string | null; undo: string[]; redo: string[] }>>({});
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
const conflictBlockCount = ref(0);
const conflictCandidateCount = ref(0);
const localGitEnabled = ref(false);
const localGitLoading = ref(false);
const localGitError = ref('');
const gitMergeLoading = ref(false);
const gitMergeError = ref('');

type FileChoice = 'local' | 'remote' | 'both' | 'manual';
const fileChoices = ref<Record<string, FileChoice>>({});

let resultModelDisposable: { dispose: () => void } | null = null;
let suppressResultTracking = false;
let changeDebounceTimer: any = null;
let lastRecordedResultValue = '';
let decorationDebounceTimer: any = null;

const progressCurrent = computed(() =>
  conflictFiles.value.length ? currentIndex.value + 1 : 0
);
const pendingActionsCount = computed(() => pendingActions.value.length);
const totalCount = computed(() => conflictFiles.value.length);
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
watch(() => props.conflictData, async (data) => {
  if (data) {
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
    conflictFiles.value = data.conflicts || [];
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
    gitattributesLoading.value = false;
    gitattributesError.value = '';
    gitattributesTarget.value = '';
    gitattributesSource.value = '';
    pendingActions.value = [];
    fileStates.value = {};
    fileChoices.value = {};
    selectedPaths.value = Array.isArray(data.conflicts) ? data.conflicts.map((c: any) => c?.new_path).filter((x: any) => typeof x === 'string' && x.trim()) : [];
    opHistory.value = [];
    finalConfirmVisible.value = false;
    diffVisible.value = false;
    resultModelDisposable?.dispose();
    resultModelDisposable = null;
    lastRecordedResultValue = '';
    if (conflictFiles.value.length > 0) {
      await loadFile(conflictFiles.value[0]);
    } else if (data.mrIid) {
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
    }
  }
}, { immediate: true });

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

function openFile(file: any) {
  if (!file?.new_path) return;
  const idx = conflictFiles.value.findIndex((f: any) => f?.new_path === file.new_path);
  if (idx >= 0) currentIndex.value = idx;
  loadFile(file);
}

async function openDiff(file: any) {
  if (!file?.new_path) return;
  if (currentFile.value?.new_path !== file.new_path) {
    await loadFile(file);
  }
  diffFilePath.value = file.new_path;
  diffLeft.value = leftSnapshot.value || '';
  diffRight.value = rightSnapshot.value || '';
  diffVisible.value = true;
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

async function applyChoiceToFile(file: any, choice: FileChoice) {
  if (!file?.new_path) return;
  if (currentFile.value?.new_path !== file.new_path) {
    await loadFile(file);
  }
  const fp = file.new_path;
  if (choice === 'local') {
    acceptCurrentBranch();
    setChoice(fp, 'local');
    return;
  }
  if (choice === 'remote') {
    acceptTargetBranch();
    setChoice(fp, 'remote');
    return;
  }
  if (choice === 'both') {
    acceptBothBranches();
    setChoice(fp, 'both');
    return;
  }
  setChoice(fp, 'manual');
  focusPanel('middle');
}

function ensureFileState(filePath: string) {
  if (!Object.prototype.hasOwnProperty.call(fileStates.value, filePath)) {
    fileStates.value[filePath] = { content: null, undo: [], redo: [] };
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
  st.redo = [];
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
    const list = await getMergeRequestConflicts({ projectId: projectId.value, mrIid: iid });
    const files = Array.isArray(list) ? list : [];
    conflictFiles.value = files;
    selectedPaths.value = files.map((f: any) => f?.new_path).filter((x: any) => typeof x === 'string' && x.trim());
    currentIndex.value = 0;
    if (files.length) {
      addHistory(`重新拉取冲突列表成功: ${files.length} 个文件`);
      await loadFile(files[0]);
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
    conflictFiles.value = files;
    selectedPaths.value = files.map((f: any) => f?.new_path).filter((x: any) => typeof x === 'string' && x.trim());
    currentIndex.value = 0;
    localGitEnabled.value = true;
    addHistory(`本地 Git 检测完成: ${files.length} 个文件`);
    if (files.length) {
      await loadFile(files[0]);
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

async function openAdhocMerge(filePath: string) {
  const fp = String(filePath || '').trim();
  if (!fp) return;
  const pseudo = { type: 'text', new_path: fp };
  conflictFiles.value = [pseudo];
  selectedPaths.value = [fp];
  currentIndex.value = 0;
  localGitEnabled.value = false;
  localGitError.value = '';
  fileLoadError.value = '';
  addHistory(`打开三方合并: ${fp}`);
  await loadFile(pseudo);
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

async function loadFile(file: any) {
  persistCurrentState();
  loading.value = true;
  currentFile.value = file;
  fileLoadError.value = '';

  try {
    const filePath = file.new_path;
    let targetContent = '';
    let sourceContent = '';
    let baseCommit: string | null = null;
    if (localGitEnabled.value) {
      const res = await localGitGetFileContents({ runId: runId.value, filePath });
      if (!res?.ok) throw new Error(String(res?.error || '本地读取文件失败'));
      targetContent = String(res.left ?? '');
      sourceContent = String(res.right ?? '');
      baseCommit = (res.baseSha as any) ?? null;
      baseSnapshot.value = String(res.base ?? '');
    } else {
      const [tgt, src, base] = await Promise.all([
        getFileContent({ projectId: projectId.value, filePath, ref: target.value }).catch(() => ''),
        getFileContent({ projectId: projectId.value, filePath, ref: source.value }).catch(() => ''),
        getMergeBase({ projectId: projectId.value, refs: [source.value, target.value] }).catch(() => null)
      ]);
      targetContent = String(tgt ?? '');
      sourceContent = String(src ?? '');
      baseCommit = base as any;
    }

    leftSnapshot.value = targetContent;
    rightSnapshot.value = sourceContent;

    let baseContent = '';
    if (localGitEnabled.value) {
      baseContent = baseSnapshot.value;
    } else {
      if (baseCommit) {
        baseContent = await getFileContent({ projectId: projectId.value, filePath, ref: baseCommit }).catch(() => '');
      }
      baseSnapshot.value = baseContent;
    }

    const m = await loadMonaco();
    if (!m) {
      console.error('Monaco Editor not loaded');
      return;
    }

    initEditors(m, filePath, baseContent, targetContent, sourceContent, detectLanguage(filePath));

  } catch (e) {
    fileLoadError.value = `加载文件失败：${String(e)}`;
  } finally {
    loading.value = false;
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
  if (!ensureEditors(monaco)) return;
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
        s.redo = [];
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
  st.redo = [];

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

function copySelection(from: 'left' | 'right') {
  const { left, right, middle } = getEditors();
  const fromEd = from === 'left' ? left : right;
  const toEd = middle;
  if (!fromEd?.getSelection || !fromEd?.getModel || !toEd?.executeEdits || !toEd?.getSelection) return;
  const sel = fromEd.getSelection();
  const fromModel = fromEd.getModel();
  const text = fromModel?.getValueInRange?.(sel);
  if (typeof text !== 'string') return;
  const filePath = getFileKey();
  if (!filePath) return;
  const resultModel = getMiddleModel();
  if (!resultModel?.getValue) return;
  const before = resultModel.getValue();
  const st = ensureFileState(filePath);
  st.undo.push(before);
  st.redo = [];
  suppressResultTracking = true;
  try {
    toEd.executeEdits('ui', [{ range: toEd.getSelection(), text, forceMoveMarkers: true }]);
  } finally {
    suppressResultTracking = false;
  }
  const after = resultModel.getValue();
  st.content = after;
  lastRecordedResultValue = after;
  addHistory(`${from === 'left' ? '复制本地选中' : '复制远程选中'}: ${filePath}`);
  setChoice(filePath, 'manual');
  scheduleUpdateDecorations();
}

function copyLocalSelectionToResult() {
  copySelection('left');
}

function copyRemoteSelectionToResult() {
  copySelection('right');
}

function undoEdit() {
  const filePath = getFileKey();
  if (!filePath) return;
  const st = fileStates.value[filePath];
  const model = getMiddleModel();
  if (!st || !model?.getValue) return;
  const current = model.getValue();
  const prev = st.undo.pop();
  if (typeof prev !== 'string') return;
  st.redo.push(current);
  applyResultValue(prev);
  addHistory(`撤销: ${filePath}`);
  scheduleUpdateDecorations();
}

function redoEdit() {
  const filePath = getFileKey();
  if (!filePath) return;
  const st = fileStates.value[filePath];
  const model = getMiddleModel();
  if (!st || !model?.getValue) return;
  const current = model.getValue();
  const next = st.redo.pop();
  if (typeof next !== 'string') return;
  st.undo.push(current);
  applyResultValue(next);
  addHistory(`重做: ${filePath}`);
  scheduleUpdateDecorations();
}

function insertLineFromPanel(from: 'left' | 'right') {
  const { left, right, middle } = getEditors();
  const fromEd = from === 'left' ? left : right;
  const toEd = middle;
  if (!fromEd?.getPosition || !fromEd?.getModel || !toEd?.getPosition || !toEd?.executeEdits) return;
  const fromPos = fromEd.getPosition();
  const fromModel = fromEd.getModel();
  const toPos = toEd.getPosition();
  if (!fromPos || !toPos) return;
  if (!fromModel?.getLineContent) return;
  const lineText = String(fromModel.getLineContent(fromPos.lineNumber) ?? '');

  const filePath = getFileKey();
  if (!filePath) return;
  const resultModel = getMiddleModel();
  if (!resultModel?.getValue) return;
  const before = resultModel.getValue();
  const st = ensureFileState(filePath);
  st.undo.push(before);
  st.redo = [];
  suppressResultTracking = true;
  try {
    const range = {
      startLineNumber: toPos.lineNumber,
      startColumn: 1,
      endLineNumber: toPos.lineNumber,
      endColumn: 1
    };
    toEd.executeEdits('ui', [{ range, text: `${lineText}\n`, forceMoveMarkers: true }]);
  } finally {
    suppressResultTracking = false;
  }
  const after = resultModel.getValue();
  st.content = after;
  lastRecordedResultValue = after;
  addHistory(`${from === 'left' ? '插入本地行' : '插入远程行'}: ${filePath}#${fromPos.lineNumber}`);
  setChoice(filePath, 'manual');
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
  st.redo = [];
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
  st.redo = [];

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

function insertLocalLineToResult() {
  insertLineFromPanel('left');
}

function insertRemoteLineToResult() {
  insertLineFromPanel('right');
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
        await loadFile(nextFile);
        return;
      }
    }

    if (!canFinish.value) {
      alert(`仍有未解决的冲突文件：${totalCount.value - resolvedCount.value} 个。请在左侧列表中选择并处理。`);
      return;
    }

    if (canFinish.value) {
      finalConfirmVisible.value = true;
    }
  } catch (e) {
    alert('提交失败: ' + e);
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
  try {
    loading.value = true;
    await createCommit({
      projectId: projectId.value,
      branch: source.value,
      message: `Merge conflict resolution for ${source.value} -> ${target.value} (MR !${props.conflictData?.mrIid || ''})`,
      actions: pendingActions.value
    });
    try {
      if (localGitEnabled.value) await localGitCleanup({ runId: runId.value });
    } catch { }
    await resolveConflict({
      runId: runId.value,
      resolution: { resolved: true }
    });
    emit('resolved');
    emit('close');
  } catch (e) {
    alert('提交失败: ' + e);
  } finally {
    loading.value = false;
    finalConfirmVisible.value = false;
  }
}

function cancelMerge() {
  try {
    if (localGitEnabled.value) localGitCleanup({ runId: runId.value });
  } catch { }
  resolveConflict({
    runId: runId.value,
    resolution: { resolved: false }
  });
  emit('close');
}

onUnmounted(() => {
  try {
    if (localGitEnabled.value) localGitCleanup({ runId: runId.value });
  } catch { }
  resultModelDisposable?.dispose();
  window.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', onResize, true);
});
</script>

<style scoped>
.conflict-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 9999;
}

.conflict-dialog {
  width: min(1400px, calc(100vw - 32px));
  height: min(900px, calc(100vh - 32px));
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #d9d9d9;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pop 160ms ease-out;
}

.conflict-header {
  padding: 12px 14px;
  border-bottom: 1px solid #e1e4e8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #ffffff;
}

.conflict-title {
  font-size: 16px;
  font-weight: 800;
  margin: 0;
  color: #222222;
}

.conflict-subtitle {
  font-size: 12px;
  color: #666666;
  margin-top: 2px;
}

.conflict-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.conflict-link {
  color: #4a86e8;
  text-decoration: none;
  font-size: 12px;
}

.conflict-link:hover {
  text-decoration: underline;
}

.conflict-progress {
  font-size: 12px;
  color: #666666;
}

.conflict-editor {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.conflict-body {
  position: absolute;
  inset: 0;
  display: flex;
  min-height: 0;
  min-width: 0;
}

.conflict-sidebar {
  width: min(340px, 34vw);
  min-width: 240px;
  border-right: 1px solid #e1e4e8;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.sidebar-mask {
  display: none;
}

.conflict-sidebar-header {
  padding: 10px 10px 8px 10px;
  border-bottom: 1px solid #e1e4e8;
  background: #ffffff;
}

.conflict-sidebar-title {
  font-size: 12px;
  font-weight: 800;
  color: #555555;
}

.conflict-sidebar-subtitle {
  font-size: 12px;
  color: #666666;
  margin-top: 2px;
}

.conflict-sidebar-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.conflict-file-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.conflict-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 6px;
}

.conflict-file-row.active {
  border-color: #1890ff;
  background: rgba(24, 144, 255, 0.10);
}

.conflict-file-check {
  flex: 0 0 auto;
}

.conflict-file-open {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.conflict-file-open:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.conflict-file-path {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: #555555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.conflict-file-status {
  flex: 0 0 auto;
  font-size: 12px;
  color: #666666;
  background: #fff0f0;
  border: 1px solid #ffd0d0;
  border-radius: 999px;
  padding: 2px 8px;
}

.conflict-file-status.ok {
  color: #666666;
  border-color: #d6ead8;
  background: #f0fff3;
}

.conflict-history {
  border-top: 1px solid #d6d6d6;
  background: #f5f5f5;
  padding: 10px;
}

.conflict-history-title {
  font-size: 12px;
  font-weight: 800;
  color: #555555;
  margin-bottom: 6px;
}

.conflict-history-list {
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
  color: #444;
}

.conflict-history-item {
  padding: 2px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.conflict-editor-main {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.merge-panes-header {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0;
  border-bottom: 1px solid #e1e4e8;
  background: #ffffff;
}

.merge-pane-tab {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 800;
  color: #555555;
  border-right: 1px solid #e1e4e8;
  cursor: pointer;
  text-align: left;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merge-pane-tab:last-child {
  border-right: 0;
}

.merge-pane-tab.middle {
  text-align: center;
}

.merge-pane-tab.active {
  background: #0366d6;
  color: #ffffff;
}

.merge-pane-title {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 800;
  color: #555555;
  border-right: 1px solid #e1e4e8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merge-pane-title:last-child {
  border-right: 0;
}

.merge-pane-title.middle {
  text-align: center;
}

.conflict-editor-host {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-x: auto;
}

.pane-wrap {
  position: relative;
  flex: 1 1 0;
  min-width: 320px;
  min-height: 0;
}

.pane-wrap.hidden {
  display: none;
}

.pane {
  position: absolute;
  inset: 0;
}

.webstorm-merge-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.webstorm-merge-control {
  position: absolute;
  right: 8px;
  display: flex;
  gap: 6px;
  pointer-events: auto;
}

.webstorm-merge-btn {
  width: 22px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid #cfcfcf;
  background: #ffffff;
  color: #555555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  line-height: 18px;
  padding: 0;
  cursor: pointer;
}

.webstorm-merge-btn:hover {
  border-color: #1890ff;
  background: #f6f8fa;
}

.conflict-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 10;
  padding: 16px;
  text-align: center;
}

.conflict-overlay.scrollable {
  overflow: auto;
  align-items: flex-start;
}

.conflict-empty {
  width: min(980px, 100%);
  text-align: left;
  margin: 8px auto 16px auto;
}

.conflict-empty-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.conflict-overlay-text {
  font-size: 14px;
  color: #555555;
}

.conflict-empty-title {
  font-size: 16px;
  font-weight: 700;
  color: #666666;
  margin: 0 0 6px 0;
}

.conflict-empty-subtitle {
  font-size: 12px;
  color: #666666;
  margin: 0;
}

.conflict-empty-files {
  margin-top: 10px;
  text-align: left;
  width: min(820px, calc(100vw - 80px));
}

.conflict-empty-files-title {
  font-size: 12px;
  color: #555555;
  margin-bottom: 6px;
  font-weight: 700;
}

.conflict-empty-files-list {
  border: 1px solid #e1e4e8;
  border-radius: 10px;
  padding: 10px;
  background: #ffffff;
  max-height: 220px;
  overflow: auto;
  font-size: 12px;
}

.conflict-empty-file {
  padding: 2px 0;
  color: #555555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.conflict-empty-file.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.file-open {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: #1890ff;
  text-align: left;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflict-empty-file.pre {
  white-space: pre-wrap;
  word-break: break-word;
}

.conflict-footer {
  padding: 12px 14px;
  border-top: 1px solid #e1e4e8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #ffffff;
}

.conflict-footer-left {
  flex: 1 1 auto;
  min-width: 0;
}

.conflict-hint {
  font-size: 12px;
  color: #666666;
}

.conflict-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.btn {
  border: 0;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  background: #1890ff;
  color: #ffffff;
  font-weight: 700;
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
  color: #666666;
  cursor: not-allowed;
  transform: none;
}

.btn.small {
  padding: 6px 10px;
  border-radius: 10px;
}

.btn.tiny {
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.1;
}

.btn.primary {
  background: #1890ff;
  color: #ffffff;
}

.btn.danger {
  background: #d12a2a;
  color: #ffffff;
}

.btn.subtle {
  background: transparent;
  border: 1px solid #cfcfcf;
  color: #555555;
  font-weight: 500;
  transition: background-color 120ms ease, transform 120ms ease, border-color 120ms ease;
}

.btn.subtle:hover {
  background: #f6f8fa;
  border-color: #1890ff;
}

.conflict-file-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
}

.conflict-file-choice {
  flex: 0 0 auto;
  font-size: 12px;
  color: #555555;
  background: #ffffff;
  border: 1px solid #e1e4e8;
  border-radius: 999px;
  padding: 2px 8px;
}

.diff-dialog,
.confirm-dialog {
  width: min(1200px, calc(100vw - 48px));
  height: min(760px, calc(100vh - 48px));
  background: #ffffff;
  border: 1px solid #d9d9d9;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: pop 160ms ease-out;
}

.diff-header,
.confirm-title {
  padding: 12px 14px;
  border-bottom: 1px solid #d6d6d6;
  background: #ffffff;
  font-size: 13px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #555555;
}

.diff-title {
  font-size: 13px;
  font-weight: 800;
}

.diff-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.diff-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e1e4e8;
}

.diff-panel:last-child {
  border-right: 0;
}

.diff-panel-title {
  padding: 10px 12px;
  border-bottom: 1px solid #e1e4e8;
  background: #ffffff;
  font-size: 12px;
  font-weight: 800;
  color: #555555;
}

.diff-code {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  background: #ffffff;
  color: #555555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
}

.diff-line {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 10px;
  padding: 2px 10px;
  border-left: 3px solid transparent;
}

.diff-line.changed {
  background: rgba(255, 235, 170, 0.65);
  border-left-color: rgba(167, 211, 255, 0.8);
}

.diff-no {
  color: #999999;
  text-align: right;
  user-select: none;
}

.diff-text {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

.confirm-subtitle {
  padding: 10px 14px 0 14px;
  font-size: 12px;
  color: #666666;
}

.confirm-list {
  padding: 10px 14px;
  overflow: auto;
  flex: 1 1 auto;
  min-height: 0;
}

.confirm-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid #e1e4e8;
  border-radius: 10px;
  background: #ffffff;
  margin-bottom: 8px;
}

.confirm-path {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: #555555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.confirm-tag {
  flex: 0 0 auto;
  font-size: 12px;
  color: #555555;
  background: #f5f5f5;
  border: 1px solid #d6d6d6;
  border-radius: 999px;
  padding: 2px 8px;
}

.confirm-tag.ok {
  color: #555555;
  border-color: #d6ead8;
  background: #f0fff3;
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

.confirm-actions {
  padding: 12px 14px;
  border-top: 1px solid #e1e4e8;
  background: #ffffff;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

:deep(.conflict-glyph) {
  width: 6px;
  height: 6px;
  margin-left: 4px;
  margin-top: 6px;
  border-radius: 2px;
  background: #1890ff;
}

@media (max-width: 980px) {
  .conflict-body {
    position: relative;
  }

  .sidebar-mask {
    display: block;
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 4;
  }

  .conflict-sidebar.drawer {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 5;
    border-right: 1px solid #e1e4e8;
    transform: translateX(-102%);
    transition: transform 160ms ease-out;
    width: min(340px, 84vw);
    min-width: 240px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  }

  .conflict-sidebar.drawer.open {
    transform: translateX(0);
  }

  .merge-panes-header {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .conflict-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .conflict-footer-actions {
    justify-content: flex-start;
  }

  .conflict-footer-left {
    flex: 0 0 auto;
  }
}

:deep(.conflict-line-local) {
  background: rgba(167, 211, 255, 0.55);
}

:deep(.conflict-line-remote) {
  background: rgba(186, 245, 202, 0.55);
}

:deep(.conflict-line-custom) {
  background: rgba(255, 235, 170, 0.65);
}
</style>
