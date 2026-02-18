<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'
import FaceClusterSelector from '~/components/FaceClusterSelector.vue'

import StepIndicator from '~/components/StepIndicator.vue'
import type { FaceCluster, Photo } from '~/utils/types'
import { selectGroupBalancedPhotos, selectGrowthPhotos } from '~/utils/selection-algorithm'
import {
  clearExistingData,
  clearPhotos,
  getLastSession,
  exportDatabase,
  importDatabase,
} from '~/utils/db'

const { isProcessing, progress: _progress, total: _total, currentSession } = usePhotoProcessor()
const step = ref<'upload' | 'step1' | 'step2' | 'step3'>('upload')
const selectedClusters = ref<FaceCluster[]>([])
const generatedPhotos = ref<Photo[]>([])
const mode = ref<'group' | 'growth'>('group')
const targetCount = ref(10)
const isSelecting = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const isConfirmed = ref(false)

const stepDefs = [
  { label: 'ステップ1', description: '写真の分類' },
  { label: 'ステップ2', description: 'モード選択 & 枚数決定' },
  { label: 'ステップ3', description: '完成' },
]

const currentStepNumber = computed<1 | 2 | 3>(() => {
  if (step.value === 'step1') return 1
  if (step.value === 'step2') return 2
  return 3
})

const completedStepNumber = computed<0 | 1 | 2 | 3>(() => {
  if (isConfirmed.value) return 3
  if (step.value === 'step3') return 2
  if (step.value === 'step2') return 1
  return 0
})

// Prevent accidental tab close
const handleBeforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault()
  e.returnValue = ''
}

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  try {
    const lastSession = await getLastSession()
    if (lastSession && lastSession.status === 'completed') {
      console.log('Restoring last session:', lastSession.id)
      currentSession.value = lastSession
      step.value = 'step1'
    }
  } catch (e) {
    console.error('Failed to restore session:', e)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

watch(
  () => currentSession.value?.status,
  (newStatus) => {
    if (newStatus === 'completed') {
      step.value = 'step1'
    }
  },
)

const onFacesSelected = (clusters: FaceCluster[]) => {
  selectedClusters.value = clusters
}

const generateAlbum = async () => {
  if (!currentSession.value) return
  isSelecting.value = true
  try {
    if (mode.value === 'group') {
      generatedPhotos.value = await selectGroupBalancedPhotos(
        currentSession.value.id,
        selectedClusters.value,
        targetCount.value,
      )
    } else {
      if (selectedClusters.value.length > 0) {
        generatedPhotos.value = await selectGrowthPhotos(
          currentSession.value.id,
          selectedClusters.value[0]!,
          targetCount.value,
        )
      }
    }
    isConfirmed.value = true
    step.value = 'step3'
  } catch (e) {
    console.error('Selection failed', e)
  } finally {
    isSelecting.value = false
  }
}


const confirmedPhotos = computed(() => generatedPhotos.value.filter((p) => !p.excluded))


const goToStep2 = () => {
  step.value = 'step2'
}

const goBackToStep1 = () => {
  generatedPhotos.value = []
  isConfirmed.value = false
  step.value = 'step1'
}

const goBackToStep2 = () => {
  isConfirmed.value = false
  step.value = 'step2'
}

const onResetDb = async () => {
  if (confirm('全てのデータを消去しますか？この操作は取り消せません。')) {
    await clearExistingData()
    window.location.reload()
  }
}

const onClearPhotos = async () => {
  if (
    confirm(
      '写真データのみを削除しますか？\n分類設定（クラスター）は保持されますが、画像は再スキャンが必要になります。',
    )
  ) {
    await clearPhotos()
    window.location.reload()
  }
}

const onExport = async () => {
  try {
    const json = await exportDatabase()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `unicorn-lax-backup-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('Export failed:', e)
    alert('エクスポートに失敗しました。')
  }
}

const triggerImport = () => {
  fileInput.value?.click()
}

const onImportFile = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (!confirm('現在のデータをすべて上書きしてインポートしますか？この操作は取り消せません。')) {
    target.value = '' // reset
    return
  }

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const json = e.target?.result as string
      await importDatabase(json)
      alert('インポートが完了しました。ページをリロードします。')
      window.location.reload()
    } catch (error) {
      console.error('Import failed:', error)
      alert('インポートに失敗しました。ファイル形式を確認してください。')
    }
  }
  reader.readAsText(file)
}

// Thumbnail handling for step3
const blobUrls = ref(new Map<string, string>())

const getThumbnailUrl = (photo: Photo): string => {
  if (!photo.thumbnail) return ''
  const existing = blobUrls.value.get(photo.id)
  if (existing) return existing
  const url = URL.createObjectURL(photo.thumbnail)
  blobUrls.value.set(photo.id, url)
  return url
}

watch(step, (newStep) => {
  if (newStep !== 'step3') {
    for (const url of blobUrls.value.values()) {
      URL.revokeObjectURL(url)
    }
    blobUrls.value.clear()
  }
})

onBeforeUnmount(() => {
  for (const url of blobUrls.value.values()) {
    URL.revokeObjectURL(url)
  }
})
</script>

<template>
  <div class="min-h-screen bg-[#FFF9F0] flex flex-col items-center py-12">
    <div class="w-full max-w-4xl px-4">
      <!-- LP Style Landing Section -->
      <div
        v-if="
          step === 'upload' &&
          !isProcessing &&
          (!currentSession || currentSession.status !== 'processing')
        "
        class="animate-fade-in"
      >
        <!-- Hero Section -->
        <div class="text-center px-4">
          <h1
            class="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#FF6B6B] to-[#FF8E53] mb-2 tracking-tight"
          >
            🦄 Unicorn Lax
          </h1>
          <p class="text-xl md:text-2xl text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            思い出選びは、AIで<span class="font-bold text-gray-800">「楽（Lax）」</span>する。<br />
            プライバシー重視。すべての処理はブラウザ内で完結します。
          </p>
          <div
            class="inline-flex items-center gap-2 mb-4 px-4 py-1.5 bg-amber-50 border border-amber-200 rounded-full"
          >
            <span class="relative flex h-2.5 w-2.5">
              <span
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"
              />
              <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
            <span class="text-sm font-semibold text-amber-700">β版 — 現在開発中です</span>
          </div>
          <p class="text-xs text-gray-400 mb-4">機能は予告なく変更される場合があります。</p>
        </div>

        <!-- Main Action (Uploader) -->
        <div
          class="max-w-3xl mx-auto bg-[#FFFCFA] rounded-3xl shadow-xl overflow-hidden border border-[#FFE8D6] my-10"
        >
          <div class="p-1 bg-gradient-to-r from-[#FF6B6B] via-[#FF8E53] to-[#FFB347]"></div>
          <div class="p-8">
            <div
              v-if="currentSession && currentSession.status === 'completed'"
              class="mb-8 p-6 bg-[#FFF5F0] border border-[#FFD4C4] rounded-xl flex flex-col sm:flex-row justify-between items-center gap-4"
            >
              <div class="flex items-center gap-4">
                <div
                  class="w-12 h-12 bg-[#FFD4C4] text-[#FF6B6B] rounded-full flex items-center justify-center flex-shrink-0"
                >
                  <span class="i-lucide-check w-6 h-6" />
                </div>
                <div>
                  <h3 class="font-bold text-[#8B4513] text-lg">分析完了</h3>
                  <p class="text-[#A0522D]">
                    {{ currentSession.totalFiles }} 枚の写真データがあります
                  </p>
                </div>
              </div>
              <button
                class="px-6 py-3 bg-[#FF6B6B] text-white rounded-lg hover:bg-[#e55a5a] font-bold shadow-lg shadow-orange-200 transition-all transform hover:-translate-y-0.5"
                @click="step = 'step1'"
              >
                選定をはじめる →
              </button>
            </div>

            <PhotoUploader :current-session-id="currentSession?.id" />

            <!-- Backup / Restore / Reset Actions -->
            <div class="pt-6 border-t border-[#FFE8D6] flex flex-wrap justify-center gap-4">
              <button
                class="px-4 py-2 text-sm bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors flex items-center gap-2"
                @click="onExport"
              >
                <span class="i-lucide-download w-4 h-4" />
                バックアップ保存
              </button>

              <button
                class="px-4 py-2 text-sm bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors flex items-center gap-2 relative overflow-hidden"
                @click="triggerImport"
              >
                <span class="i-lucide-upload w-4 h-4" />
                データ復元
                <input
                  ref="fileInput"
                  type="file"
                  accept=".json"
                  class="absolute inset-0 opacity-0 cursor-pointer"
                  @change="onImportFile"
                />
              </button>

              <div
                class="w-full sm:w-auto h-px sm:h-auto sm:border-l border-gray-200 mx-2 hidden sm:block"
              ></div>

              <button
                class="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                @click="onClearPhotos"
              >
                写真のみ削除
              </button>
              <button
                class="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                @click="onResetDb"
              >
                全データ初期化
              </button>
            </div>
          </div>
        </div>
        <div class="text-center mt-20 text-gray-400 text-sm pb-8">
          &copy; {{ new Date().getFullYear() }} Unicorn Lax. All processing is done locally.
        </div>
      </div>

      <!-- Processing State -->
      <div
        v-else-if="step === 'upload' || isProcessing || currentSession?.status === 'processing'"
        class="bg-[#FFFCFA] p-8 rounded-2xl shadow-lg mb-6 max-w-2xl mx-auto"
      >
        <PhotoUploader :current-session-id="currentSession?.id" />
      </div>

      <!-- === Step Flow (step1 / step2 / step3) === -->
      <template v-if="step === 'step1' || step === 'step2' || step === 'step3'">
        <!-- Step Indicator -->
        <StepIndicator
          :current-step="currentStepNumber"
          :completed-step="completedStepNumber"
          :steps="stepDefs"
        />

        <!-- Step 1: 写真の分類 -->
        <div v-if="step === 'step1' && currentSession" class="bg-[#FFFCFA] p-6 rounded-xl shadow-md mb-6 border border-[#FFE8D6]">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-gray-900">写真の分類</h2>
            <button class="text-sm text-[#FF6B6B] hover:underline" @click="step = 'upload'">
              ← 写真を追加 / アップロード画面へ
            </button>
          </div>
          <p class="mb-4 text-gray-600">
            AIが検出した人物グループを確認し、必要に応じて写真を正しいグループに移動してください。
          </p>

          <FaceClusterSelector
            :session="currentSession"
            hide-selection
          />

          <div class="mt-6 flex justify-end">
            <button
              class="px-6 py-2.5 bg-[#FF6B6B] text-white rounded-lg hover:bg-[#e55a5a] font-semibold shadow-md shadow-orange-200 transition-all transform hover:-translate-y-0.5"
              @click="goToStep2"
            >
              次へ →
            </button>
          </div>
        </div>

        <!-- Step 2: モード選択 & 枚数決定 -->
        <div v-if="step === 'step2' && currentSession" class="bg-[#FFFCFA] p-6 rounded-xl shadow-md mb-6 border border-[#FFE8D6]">
          <h2 class="text-xl font-bold text-gray-900 mb-4">モード選択 & 枚数決定</h2>

          <!-- Mode Selection -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">モード選択</label>
            <select
              v-model="mode"
              class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-[#FF6B6B] focus:border-[#FF6B6B] sm:text-sm rounded-md"
            >
              <option value="group">グループバランス (複数人のバランス重視)</option>
              <option value="growth">成長記録 (特定の1人の時系列)</option>
            </select>
          </div>

          <!-- Target Count -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">選定枚数 (目標)</label>
            <input
              v-model.number="targetCount"
              type="number"
              class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md"
            />
          </div>

          <!-- Face/Group Selection -->
          <p class="mb-4 text-gray-600">アルバムに入れたい人物を選択してください。</p>

          <FaceClusterSelector
            :session="currentSession"
            :single-selection="mode === 'growth'"
            selection-only
            @select="onFacesSelected"
          />

          <!-- Generate Button -->
          <div class="mt-6 flex justify-center">
            <button
              :disabled="selectedClusters.length === 0 || isSelecting"
              class="px-8 py-3 bg-gradient-to-r from-[#FF6B6B] to-[#FF8E53] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-bold shadow-lg shadow-orange-200 transition-all transform hover:-translate-y-0.5 text-lg"
              @click="generateAlbum"
            >
              {{ isSelecting ? '生成中...' : 'アルバム候補を生成' }}
            </button>
          </div>

          <!-- Back button -->
          <div class="mt-6 flex justify-start">
            <button
              class="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              @click="goBackToStep1"
            >
              ← 分類に戻る
            </button>
          </div>
        </div>

        <!-- Step 3: 完成 -->
        <div v-if="step === 'step3'" class="bg-[#FFFCFA] p-6 rounded-xl shadow-md mb-6 border border-[#FFE8D6]">
          <div class="text-center mb-6">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
            </div>
            <h2 class="text-2xl font-bold text-gray-900">選定完了</h2>
            <p class="mt-1 text-gray-600">{{ confirmedPhotos.length }} 枚の写真を確定しました。</p>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <div
              v-for="photo in confirmedPhotos"
              :key="photo.id"
              class="border rounded-lg overflow-hidden"
            >
              <div class="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                <img
                  v-if="getThumbnailUrl(photo)"
                  :src="getThumbnailUrl(photo)"
                  :alt="photo.name"
                  class="w-full h-full object-cover"
                />
                <span v-else class="text-gray-500 text-xs p-2 text-center truncate">{{
                  photo.name
                }}</span>
              </div>
              <div class="p-2 text-xs text-gray-600 bg-white truncate">
                {{ photo.dateStr }}
              </div>
            </div>
          </div>

          <!-- Backup Prompt -->
          <div class="mt-8 p-5 bg-amber-50 border border-amber-200 rounded-xl">
            <div class="flex items-start gap-3">
              <div class="flex-shrink-0 w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                <span class="i-lucide-download w-5 h-5" />
              </div>
              <div class="flex-1">
                <h4 class="font-bold text-amber-900 text-sm">バックアップを取りましょう</h4>
                <p class="text-amber-700 text-sm mt-1">
                  選定結果を保存するために、バックアップファイルをダウンロードすることをおすすめします。
                </p>
                <button
                  class="mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-semibold transition-colors inline-flex items-center gap-2"
                  @click="onExport"
                >
                  <span class="i-lucide-download w-4 h-4" />
                  バックアップ保存
                </button>
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-between gap-2">
            <button
              class="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              @click="goBackToStep2"
            >
              ← 確認画面に戻る
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
