<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'
import FaceClusterSelector from '~/components/FaceClusterSelector.vue'
import AlbumPreview from '~/components/AlbumPreview.vue'
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
const step = ref<'upload' | 'select-faces' | 'review' | 'confirmed'>('upload')
const selectedClusters = ref<FaceCluster[]>([])
const generatedPhotos = ref<Photo[]>([])
const mode = ref<'group' | 'growth'>('group')
const targetCount = ref(10)
const isSelecting = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

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
      step.value = 'select-faces'
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
      step.value = 'select-faces'
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
    step.value = 'review'
  } catch (e) {
    console.error('Selection failed', e)
  } finally {
    isSelecting.value = false
  }
}

const onPhotosUpdated = (photos: Photo[]) => {
  generatedPhotos.value = photos
}

const confirmedPhotos = computed(() => generatedPhotos.value.filter((p) => !p.excluded))

const confirmSelection = () => {
  step.value = 'confirmed'
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
  reader.readAsText(file) // Read as text for JSON parsing
}

// Thumbnail handling for confirmed step
const blobUrls = ref(new Map<string, string>())

const getThumbnailUrl = (photo: Photo): string => {
  if (!photo.thumbnail) return ''
  const existing = blobUrls.value.get(photo.id)
  if (existing) return existing
  const url = URL.createObjectURL(photo.thumbnail)
  blobUrls.value.set(photo.id, url)
  return url
}

// Clean up blob URLs when component unmounts or when leaving confirmed step
watch(step, (newStep) => {
  if (newStep !== 'confirmed') {
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
  <div class="min-h-screen bg-gray-50 flex flex-col items-center py-12">
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
            class="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-2 tracking-tight"
          >
            Unicorn Lax
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
          class="max-w-3xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 my-10"
        >
          <div class="p-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>
          <div class="p-8">
            <div
              v-if="currentSession && currentSession.status === 'completed'"
              class="mb-8 p-6 bg-blue-50 border border-blue-100 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-4"
            >
              <div class="flex items-center gap-4">
                <div
                  class="w-12 h-12 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center flex-shrink-0"
                >
                  <span class="i-lucide-check w-6 h-6" />
                </div>
                <div>
                  <h3 class="font-bold text-blue-900 text-lg">分析完了</h3>
                  <p class="text-blue-700">
                    {{ currentSession.totalFiles }} 枚の写真データがあります
                  </p>
                </div>
              </div>
              <button
                class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold shadow-lg shadow-blue-200 transition-all transform hover:-translate-y-0.5"
                @click="step = 'select-faces'"
              >
                選定をはじめる →
              </button>
            </div>

            <PhotoUploader :current-session-id="currentSession?.id" />

            <!-- Backup / Restore / Reset Actions -->
            <div class="pt-6 border-t border-gray-100 flex flex-wrap justify-center gap-4">
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

      <!-- Step 1: Processing State (Hidden in LP view mostly, but kept for logic) -->
      <div
        v-else-if="step === 'upload' || isProcessing || currentSession?.status === 'processing'"
        class="bg-white p-8 rounded-2xl shadow-lg mb-6 max-w-2xl mx-auto"
      >
        <PhotoUploader :current-session-id="currentSession?.id" />
      </div>

      <!-- Step 2: Select Faces -->
      <div
        v-if="step === 'select-faces' && currentSession"
        class="bg-white p-6 rounded shadow mb-6"
      >
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-black">対象の人物を選択</h2>
          <button class="text-sm text-blue-600 hover:underline" @click="step = 'upload'">
            ← 写真を追加 / アップロード画面へ
          </button>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700">モード選択</label>
          <select
            v-model="mode"
            class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
          >
            <option value="group">グループバランス (複数人のバランス重視)</option>
            <option value="growth">成長記録 (特定の1人の時系列)</option>
          </select>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700">選定枚数 (目標)</label>
          <input
            v-model.number="targetCount"
            type="number"
            class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md"
          />
        </div>

        <p class="mb-4 text-gray-600 text-black">アルバムに入れたい人物を選択してください。</p>

        <FaceClusterSelector
          :session="currentSession"
          :single-selection="mode === 'growth'"
          @select="onFacesSelected"
        />

        <div class="mt-6 flex justify-end">
          <button
            :disabled="selectedClusters.length === 0 || isSelecting"
            class="px-6 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            @click="generateAlbum"
          >
            {{ isSelecting ? '生成中...' : 'アルバム候補を生成' }}
          </button>
        </div>
      </div>

      <!-- Step 3: Review -->
      <div v-if="step === 'review'" class="bg-white p-6 rounded shadow mb-6">
        <h2 class="text-xl font-bold mb-2">写真の確認・調整</h2>
        <p class="mb-4 text-sm text-gray-500">
          クリックして除外/追加を切り替えられます。顔が検出されなかった写真も下に表示されています。
        </p>

        <AlbumPreview :photos="generatedPhotos" @update:photos="onPhotosUpdated" />

        <div class="mt-6 flex justify-between items-center">
          <button
            class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50"
            @click="step = 'select-faces'"
          >
            戻る
          </button>
          <button
            class="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            @click="confirmSelection"
          >
            選択を確定する ({{ confirmedPhotos.length }} 枚)
          </button>
        </div>
      </div>

      <!-- Step 4: Confirmed -->
      <div v-if="step === 'confirmed'" class="bg-white p-6 rounded shadow mb-6">
        <h2 class="text-xl font-bold mb-2">選定完了</h2>
        <p class="mb-4 text-gray-600">{{ confirmedPhotos.length }} 枚の写真を確定しました。</p>

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

        <div class="mt-6 flex justify-between gap-2">
          <button
            class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50"
            @click="step = 'review'"
          >
            確認画面に戻る
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
