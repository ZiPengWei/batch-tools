<template>
  <div v-if="visible" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex flex-col items-center justify-center">
    <div class="bg-white w-[95vw] h-[90vh] flex flex-col rounded shadow-lg overflow-hidden">
      <!-- Header -->
      <div class="p-4 border-b flex justify-between items-center bg-gray-50">
        <div>
          <h2 class="text-lg font-bold">解决冲突: {{ currentFile?.new_path || 'Unknown File' }}</h2>
          <div class="text-sm text-gray-500">
            合并: {{ source }} (Incoming) -> {{ target }} (Current)
          </div>
        </div>
        <div class="flex gap-2 items-center">
            <span class="text-sm text-gray-600 mr-4">
                进度: {{ currentIndex + 1 }} / {{ conflictFiles.length }}
            </span>
        </div>
      </div>

      <!-- Editor Area -->
      <div class="flex-1 relative overflow-hidden" ref="editorContainer">
        <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-white z-10">
            <span class="text-lg">加载文件内容中...</span>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-4 border-t flex gap-4 justify-between bg-gray-50">
        <div class="flex gap-2 text-sm text-gray-600 items-center">
            提示: 左侧为当前分支，右侧为来源分支，中间为合并结果。
        </div>
        <div class="flex gap-2">
            <button class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600" @click="cancelMerge">取消合并</button>
            <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" @click="markResolved">
                {{ isLastFile ? '完成合并' : '下一个文件' }}
            </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onUnmounted, onMounted } from 'vue';
import { getFileContent, createCommit, resolveConflict } from '../ipc/bridge';

// Ensure styles are loaded
import 'monaco-editor/min/vs/editor/editor.main.css';

const props = defineProps<{
    visible: boolean;
    conflictData: any;
}>();

const emit = defineEmits(['close', 'resolved']);

const editorContainer = ref<HTMLElement>();
const mergeEditor = shallowRef<any>();

let monaco: any = null;
let monacoPromise: Promise<void> | null = null;

onMounted(() => {
    // Dynamic import to avoid issues in tests (jsdom) and optimize loading
    if (typeof window !== 'undefined') {
        monacoPromise = (async () => {
            try {
                if (monaco) return;
                monaco = await import('monaco-editor');
                
                const editorWorker = (await import('monaco-editor/esm/vs/editor/editor.worker?worker')).default;
                const jsonWorker = (await import('monaco-editor/esm/vs/language/json/json.worker?worker')).default;
                const cssWorker = (await import('monaco-editor/esm/vs/language/css/css.worker?worker')).default;
                const htmlWorker = (await import('monaco-editor/esm/vs/language/html/html.worker?worker')).default;
                const tsWorker = (await import('monaco-editor/esm/vs/language/typescript/ts.worker?worker')).default;

                self.MonacoEnvironment = {
                    getWorker(_, label) {
                        if (label === 'json') return new jsonWorker();
                        if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
                        if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
                        if (label === 'typescript' || label === 'javascript') return new tsWorker();
                        return new editorWorker();
                    }
                };
            } catch (e) {
                console.error('Failed to load Monaco Editor', e);
            }
        })();
    }
});

const loading = ref(false);
const currentIndex = ref(0);
const conflictFiles = ref<any[]>([]);
const currentFile = ref<any>(null);

const projectId = ref(0);
const source = ref('');
const target = ref('');
const runId = ref('');

const isLastFile = computed(() => currentIndex.value >= conflictFiles.value.length - 1);

watch(() => props.conflictData, async (data) => {
    if (data) {
        projectId.value = data.projectId;
        source.value = data.source;
        target.value = data.target;
        runId.value = data.runId;
        conflictFiles.value = data.conflicts || [];
        currentIndex.value = 0;
        if (conflictFiles.value.length > 0) {
            await loadFile(conflictFiles.value[0]);
        }
    }
}, { immediate: true });

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
    loading.value = true;
    currentFile.value = file;
    
    try {
        const filePath = file.new_path;
        
        // Fetch contents
        // Input 1 (Left): Target (Current Branch)
        // Input 2 (Right): Source (Incoming Branch)
        const [targetContent, sourceContent] = await Promise.all([
            getFileContent({ projectId: projectId.value, filePath, ref: target.value }).catch(() => ''),
            getFileContent({ projectId: projectId.value, filePath, ref: source.value }).catch(() => '')
        ]);
        
        // Use targetContent as base for now
        const baseContent = targetContent; 
        
        if (monacoPromise) await monacoPromise;
        if (!monaco) {
            console.error('Monaco Editor not loaded');
            return;
        }

        initEditor(baseContent, targetContent, sourceContent, detectLanguage(filePath));
        
    } catch (e) {
        console.error("Failed to load file contents", e);
    } finally {
        loading.value = false;
    }
}

function initEditor(base: string, lhs: string, rhs: string, language: string) {
    if (!editorContainer.value) return;
    
    if (mergeEditor.value) {
        mergeEditor.value.dispose();
    }
    
    // Create Merge Editor
    mergeEditor.value = (monaco.editor as any).createMergeEditor(editorContainer.value, {
        readOnly: false,
        originalEditable: false,
        theme: 'vs'
    });
    
    const modelBase = monaco.editor.createModel(base, language);
    const modelInput1 = monaco.editor.createModel(lhs, language); // Left (Current)
    const modelInput2 = monaco.editor.createModel(rhs, language); // Right (Incoming)
    const modelResult = monaco.editor.createModel(lhs, language); // Result starts as Current
    
    mergeEditor.value.setModel({
        base: modelBase,
        input1: { model: modelInput1, detail: `当前分支 (${target.value})`, description: '当前分支' },
        input2: { model: modelInput2, detail: `来源分支 (${source.value})`, description: '来源分支' },
        result: modelResult
    });
}

async function markResolved() {
    if (!mergeEditor.value) return;
    const modelResult = mergeEditor.value.getModel().result;
    const content = modelResult.getValue();
    
    try {
        loading.value = true;
        // Commit resolution to Source Branch
        await createCommit({
            projectId: projectId.value,
            branch: source.value,
            message: `Merge conflict resolution for ${currentFile.value.new_path}`,
            actions: [{
                action: 'update',
                file_path: currentFile.value.new_path,
                content: content
            }]
        });
        
        if (!isLastFile.value) {
            currentIndex.value++;
            await loadFile(conflictFiles.value[currentIndex.value]);
        } else {
            // All resolved
            await resolveConflict({
                runId: runId.value,
                resolution: { resolved: true }
            });
            emit('resolved');
            emit('close');
        }
    } catch (e) {
        alert('提交失败: ' + e);
    } finally {
        loading.value = false;
    }
}

function cancelMerge() {
     resolveConflict({
        runId: runId.value,
        resolution: { resolved: false }
    });
    emit('close');
}

onUnmounted(() => {
    mergeEditor.value?.dispose();
});
</script>

<style scoped>
/* Ensure editor takes full height */
</style>
