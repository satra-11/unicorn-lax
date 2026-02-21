<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'
import FaceClusterSelector from '~/components/FaceClusterSelector.vue'
import AlbumModeSelector from '~/components/AlbumModeSelector.vue'

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
const isFinalized = ref(false)
const weights = ref({
  smile: 0,
  faceScore: 0,
  orientation: 0,
  blur: 0,
  groupBalance: 0.5,
})

const stepDefs = [
  { label: 'ステップ1', description: '人物の確認・整理' },
  { label: 'ステップ2', description: 'アルバムの設定' },
  { label: 'ステップ3', description: '仕上げ' },
]

const currentStepNumber = computed<1 | 2 | 3>(() => {
  if (step.value === 'step1') return 1
  if (step.value === 'step2') return 2
  return 3
})

const completedStepNumber = computed<0 | 1 | 2 | 3>(() => {
  if (isFinalized.value) return 3
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
  (newStatus, oldStatus) => {
    if (newStatus === 'completed' && oldStatus === 'processing') {
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
  // Reset finalized state if regenerating
  isFinalized.value = false

  try {
    if (mode.value === 'group') {
      generatedPhotos.value = await selectGroupBalancedPhotos(
        currentSession.value.id,
        selectedClusters.value,
        targetCount.value,
        weights.value,
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

const clusterCounts = computed(() => {
  const counts = new Map<string, number>()
  selectedClusters.value.forEach((c) => counts.set(c.id, 0))

  confirmedPhotos.value.forEach((photo) => {
    if (photo.matchedSubjects) {
      photo.matchedSubjects.forEach((id) => {
        if (counts.has(id)) {
          counts.set(id, counts.get(id)! + 1)
        }
      })
    }
  })

  return selectedClusters.value.map((c) => ({
    cluster: c,
    count: counts.get(c.id) || 0,
  }))
})

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
  if (confirm('すべてのデータを消しますか？一度消すと元に戻せません。')) {
    await clearExistingData()
    window.location.reload()
  }
}

const onClearPhotos = async () => {
  if (
    confirm(
      '写真だけを削除しますか？\n人物グループの設定はそのまま残りますが、写真の読み込みをやり直す必要があります。',
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
    alert('バックアップの保存に失敗しました。')
  }
}

const triggerImport = () => {
  fileInput.value?.click()
}

const onImportFile = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (!confirm('保存済みのデータをすべて入れ替えますか？一度入れ替えると元に戻せません。')) {
    target.value = '' // reset
    return
  }

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const json = e.target?.result as string
      await importDatabase(json)
      alert('データの読み込みが完了しました。画面を更新します。')
      window.location.reload()
    } catch (error) {
      console.error('Import failed:', error)
      alert('データの読み込みに失敗しました。正しいバックアップファイルか確認してください。')
    }
  }
  reader.readAsText(file)
}

// Thumbnail handling for step3
const blobUrls = ref(new Map<string, string>())
const clusterBlobUrls = ref(new Map<string, string>())

const getThumbnailUrl = (photo: Photo): string => {
  if (!photo.thumbnail) return ''
  const existing = blobUrls.value.get(photo.id)
  if (existing) return existing
  const url = URL.createObjectURL(photo.thumbnail)
  blobUrls.value.set(photo.id, url)
  return url
}

const getClusterThumbnailUrl = (cluster: FaceCluster): string => {
  if (!cluster.thumbnail) return ''
  const existing = clusterBlobUrls.value.get(cluster.id)
  if (existing) return existing
  const url = URL.createObjectURL(cluster.thumbnail)
  clusterBlobUrls.value.set(cluster.id, url)
  return url
}

watch(step, (newStep) => {
  if (newStep !== 'step3') {
    for (const url of blobUrls.value.values()) {
      URL.revokeObjectURL(url)
    }
    blobUrls.value.clear()

    for (const url of clusterBlobUrls.value.values()) {
      URL.revokeObjectURL(url)
    }
    clusterBlobUrls.value.clear()
  }
})

const getPhotoMetrics = (photo: Photo) => {
  let smile = 0
  let orientation = 0
  const blur = photo.blurScore ?? 0

  if (photo.faces && photo.faces.length > 0) {
    smile = photo.faces.reduce((sum, f) => sum + (f.smileScore ?? 0), 0) / photo.faces.length

    const avgPan =
      photo.faces.reduce((sum, f) => sum + Math.abs(f.panScore ?? 0), 0) / photo.faces.length
    orientation = 1 - avgPan
  }

  return {
    smile: Math.round(smile * 100),
    orientation: Math.round(orientation * 100),
    blur: Math.round(blur * 100),
  }
}

onBeforeUnmount(() => {
  for (const url of blobUrls.value.values()) {
    URL.revokeObjectURL(url)
  }
  for (const url of clusterBlobUrls.value.values()) {
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
          <p class="text-md md:text-xl text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
            思い出選びは、AIで<span class="font-bold text-gray-800">「楽（Lax）」</span>する。
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
                  <h3 class="font-bold text-[#8B4513] text-lg">写真の読み込み完了</h3>
                  <p class="text-[#A0522D]">
                    {{ currentSession.totalFiles }} 枚の写真データがあります
                  </p>
                </div>
              </div>
              <button
                class="px-6 py-3 bg-[#FF6B6B] text-white rounded-lg hover:bg-[#e55a5a] font-bold shadow-lg shadow-orange-200 transition-all transform hover:-translate-y-0.5"
                @click="step = 'step1'"
              >
                アルバムづくりをはじめる →
              </button>
            </div>

            <PhotoUploader :current-session-id="currentSession?.id" />

            <!-- Backup / Restore / Reset Actions -->
            <div class="pt-6 border-t border-[#FFE8D6] flex flex-wrap justify-center gap-4">
              <button
                class="px-4 py-2 text-sm bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors flex items-center gap-2"
                @click="onExport"
              >
                バックアップ保存
              </button>

              <button
                class="px-4 py-2 text-sm bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors flex items-center gap-2 relative overflow-hidden"
                @click="triggerImport"
              >
                バックアップから復元
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
                写真だけ削除
              </button>
              <button
                class="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                @click="onResetDb"
              >
                すべてのデータを削除
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
        <div
          v-if="step === 'step1' && currentSession"
          class="bg-[#FFFCFA] p-6 rounded-xl shadow-md mb-6 border border-[#FFE8D6]"
        >
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-2xl font-bold text-gray-900">人物の確認・整理</h2>
          </div>
          <p class="mb-4 text-gray-600">
            AIが自動で写真を見分けました。間違いがあれば、写真を正しい人のグループに移動してください。
          </p>
          <div class="mt-8">
            <h3 class="text-lg font-semibold text-black mb-4">見つかった人</h3>
            <FaceClusterSelector :session="currentSession" hide-selection />
          </div>

          <div class="mt-6 flex justify-between">
            <button
              class="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              @click="step = 'upload'"
            >
              ← 写真を追加する
            </button>
            <button
              class="px-6 py-2.5 bg-[#FF6B6B] text-white rounded-lg hover:bg-[#e55a5a] font-semibold shadow-md shadow-orange-200 transition-all transform hover:-translate-y-0.5"
              @click="goToStep2"
            >
              次へ →
            </button>
          </div>
        </div>

        <!-- Step 2: モード選択 & 枚数決定 -->
        <div
          v-if="step === 'step2' && currentSession"
          class="bg-[#FFFCFA] p-6 rounded-xl shadow-md mb-6 border border-[#FFE8D6]"
        >
          <h2 class="text-2xl font-bold text-gray-900 mb-4">アルバムの設定</h2>
          <p class="mb-4 text-gray-600">
            アルバムのタイプ、写真の枚数、写る人物を設定してください。
          </p>

          <!-- Mode Selection -->
          <div class="mb-4">
            <h3 class="text-lg font-semibold text-black mb-4">アルバムのタイプ</h3>
            <AlbumModeSelector v-model="mode" />
          </div>

          <!-- Target Count -->
          <div class="mb-6">
            <h3 class="text-lg font-semibold text-black mb-4">選ぶ写真の枚数</h3>
            <div class="flex items-center gap-6">
              <div class="w-[70%]">
                <input
                  v-model.number="targetCount"
                  type="range"
                  min="5"
                  max="100"
                  step="1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FF6B6B]"
                />
                <div class="flex justify-between text-xs text-gray-500 mt-2 px-1">
                  <span>5枚</span>
                  <span>50枚</span>
                  <span>100枚</span>
                </div>
              </div>
              <div
                class="flex items-baseline shrink-0 border-b-2 border-transparent hover:border-[#FFD4C4] focus-within:border-[#FF6B6B] transition-colors pb-1 px-2"
              >
                <input
                  v-model.number="targetCount"
                  type="number"
                  min="1"
                  class="text-4xl font-extrabold text-[#FF6B6B] w-20 text-right bg-transparent outline-none font-sans [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span class="text-xl font-bold text-[#FF6B6B]">枚</span>
              </div>
            </div>
          </div>

          <!-- Face/Group Selection -->
          <div class="mt-8">
            <h3 class="text-lg font-semibold text-black mb-4">人物を選択</h3>
            <FaceClusterSelector
              :session="currentSession"
              :single-selection="mode === 'growth'"
              selection-only
              @select="onFacesSelected"
            />
          </div>

          <!-- Back button -->
          <div class="mt-6 flex justify-between">
            <button
              class="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              @click="goBackToStep1"
            >
              ← 人物の確認に戻る
            </button>
            <button
              :disabled="selectedClusters.length === 0 || isSelecting"
              class="px-6 py-2.5 bg-gradient-to-r from-[#FF6B6B] to-[#FF8E53] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-bold shadow-lg shadow-orange-200 transition-all transform hover:-translate-y-0.5"
              @click="generateAlbum"
            >
              {{ isSelecting ? '生成中...' : '写真をえらぶ' }}
            </button>
          </div>
        </div>

        <!-- Step 3: 仕上げ (Final Adjustment) -->
        <div
          v-if="step === 'step3'"
          class="bg-[#FFFCFA] p-6 rounded-xl shadow-md mb-6 border border-[#FFE8D6]"
        >
          <div class="text-center mb-6">
            <h2 class="text-2xl font-bold text-gray-900">アルバムの仕上げ</h2>
            <p class="mt-1 text-gray-600">
              {{ confirmedPhotos.length }} 枚の写真が選ばれました。 好みに合わせて調整できます。
            </p>
          </div>

          <!-- Cluster Appearance Counts Visualization -->
          <div class="mb-8 p-6 bg-white rounded-xl border border-[#FFE8D6] shadow-sm">
            <h3 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span class="i-lucide-users w-5 h-5 text-[#FF6B6B]" />
              各メンバーの写っている枚数
            </h3>
            <div class="flex flex-wrap gap-3">
              <div
                v-for="item in clusterCounts"
                :key="item.cluster.id"
                class="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border shadow-sm transition-all"
              >
                <img
                  v-if="item.cluster.thumbnail"
                  :src="getClusterThumbnailUrl(item.cluster)"
                  class="w-6 h-6 rounded-full object-cover bg-gray-200 ring-1 ring-gray-300"
                />
                <div
                  v-else
                  class="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold ring-1 ring-orange-200"
                >
                  {{ item.cluster.label.charAt(0) }}
                </div>
                <span class="text-sm font-medium text-gray-700">{{ item.cluster.label }}</span>
                <span
                  class="text-xs font-bold text-white px-2 py-0.5 rounded-full shadow-sm"
                  :class="item.count === 0 ? 'bg-gray-400' : 'bg-[#FF6B6B]'"
                >
                  {{ item.count }}枚
                </span>
              </div>
            </div>
            <p
              class="text-xs text-gray-500 mt-4 flex items-start gap-1.5 leading-relaxed bg-[#FFF9F0] p-3 rounded-lg border border-[#FFE8D6]"
            >
              <span class="i-lucide-info w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
              <span
                >「全員が均等に写る」ことを最優先に調整されます。<br />グループ写真に写っている場合も、それぞれ1枚としてカウントしています。</span
              >
            </p>
          </div>

          <!-- Weights Controls -->
          <div class="mb-8 p-6 bg-orange-50 rounded-xl border border-orange-100">
            <h3 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span class="i-lucide-sliders-horizontal w-5 h-5" />
              好みで微調整
            </h3>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <!-- Smile -->
              <div>
                <div class="flex justify-between mb-1">
                  <label class="text-sm font-semibold text-gray-700">笑顔重視</label>
                  <span class="text-xs text-gray-500">{{ Math.round(weights.smile * 100) }}%</span>
                </div>
                <input
                  v-model.number="weights.smile"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FF6B6B]"
                />
              </div>

              <!-- Orientation -->
              <div>
                <div class="flex justify-between mb-1">
                  <label class="text-sm font-semibold text-gray-700">カメラ目線</label>
                  <span class="text-xs text-gray-500"
                    >{{ Math.round(weights.orientation * 100) }}%</span
                  >
                </div>
                <input
                  v-model.number="weights.orientation"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FF6B6B]"
                />
              </div>

              <!-- Blur -->
              <div>
                <div class="flex justify-between mb-1">
                  <label class="text-sm font-semibold text-gray-700">ブレてない写真</label>
                  <span class="text-xs text-gray-500">{{ Math.round(weights.blur * 100) }}%</span>
                </div>
                <input
                  v-model.number="weights.blur"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FF6B6B]"
                />
              </div>

              <!-- Group Balance -->
              <div class="col-span-1 md:col-span-2">
                <div class="flex justify-between mb-1">
                  <label class="text-sm font-semibold text-gray-700">グループバランス</label>
                  <span
                    class="text-xs font-medium"
                    :class="
                      weights.groupBalance > 0.6
                        ? 'text-blue-600'
                        : weights.groupBalance < 0.4
                          ? 'text-pink-600'
                          : 'text-gray-500'
                    "
                  >
                    {{
                      weights.groupBalance > 0.6
                        ? 'みんなで写っている写真を優先'
                        : weights.groupBalance < 0.4
                          ? '個人の写真を優先'
                          : 'バランスよく'
                    }}
                  </span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-xs text-gray-500 w-12 text-right">個人</span>
                  <input
                    v-model.number="weights.groupBalance"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FF8E53]"
                  />
                  <span class="text-xs text-gray-500 w-12">グループ</span>
                </div>
              </div>
            </div>

            <div class="mt-6 flex justify-center">
              <button
                class="px-6 py-2 bg-white border border-orange-300 text-orange-600 rounded-full hover:bg-orange-50 font-bold transition-colors shadow-sm flex items-center gap-2"
                :disabled="isSelecting"
                @click="generateAlbum"
              >
                <span v-if="isSelecting" class="i-lucide-loader-2 animate-spin" />
                <span v-else class="i-lucide-refresh-cw" />
                写真を再選択する
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
            <div
              v-for="photo in confirmedPhotos"
              :key="photo.id"
              class="border rounded-lg overflow-hidden relative group"
            >
              <div
                class="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden"
              >
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
              <div
                class="p-2 grid grid-cols-2 gap-x-2 gap-y-1 bg-gray-50 text-[10px] text-gray-600 border-t"
              >
                <div class="flex justify-between">
                  <span>笑顔:</span>
                  <span class="font-medium">{{ getPhotoMetrics(photo).smile }}</span>
                </div>
                <div class="flex justify-between">
                  <span>目線:</span>
                  <span class="font-medium">{{ getPhotoMetrics(photo).orientation }}</span>
                </div>
                <div class="flex justify-between">
                  <span>ブレ:</span>
                  <span class="font-medium">{{ getPhotoMetrics(photo).blur }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-between items-center pt-4 border-t border-gray-200">
            <button
              class="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              @click="goBackToStep2"
            >
              ← 設定に戻る
            </button>
            <button
              class="px-8 py-3 bg-[#FF6B6B] text-white rounded-lg hover:bg-[#e55a5a] font-bold shadow-lg shadow-orange-200 transition-all transform hover:-translate-y-0.5 text-lg"
              @click="isFinalized = true"
            >
              これでOK！
            </button>
          </div>
        </div>

        <!-- Completed View -->
        <div
          v-if="isFinalized"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in"
        >
          <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 relative overflow-hidden">
            <!-- Confetti/Success decoration -->
            <div
              class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#FF6B6B] via-[#FF8E53] to-[#FFB347]"
            ></div>

            <div class="text-center">
              <div
                class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 text-green-600 mb-6 mx-auto"
              >
                <span class="i-lucide-check w-10 h-10" />
              </div>
              <h2 class="text-3xl font-bold text-gray-900 mb-2">完成です！</h2>
              <p class="text-gray-600 mb-8">
                素敵なアルバムのための写真選びが完了しました。<br />
                結果を保存して、大切に使ってくださいね。
              </p>

              <div class="flex flex-col gap-3">
                <button
                  class="w-full px-6 py-3 bg-[#FF6B6B] text-white rounded-xl hover:bg-[#e55a5a] font-bold shadow-md transition-all flex items-center justify-center gap-2"
                  @click="onExport"
                >
                  <span class="i-lucide-download" />
                  バックアップを保存する
                </button>
                <button
                  class="w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold transition-all"
                  @click="isFinalized = false"
                >
                  調整画面に戻る
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
