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
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col items-center py-12">
    <h1 class="text-4xl font-bold text-gray-800 mb-8">Unicorn Lax</h1>

    <div class="w-full max-w-4xl px-4">
      <!-- Step 1: Upload -->
      <div
        v-if="step === 'upload' || isProcessing || currentSession?.status === 'processing'"
        class="bg-white p-6 rounded shadow mb-6"
      >
        <div
          v-if="currentSession && currentSession.status === 'completed'"
          class="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex justify-between items-center"
        >
          <div>
            <p class="font-bold text-blue-900">分析済みのデータがあります</p>
            <p class="text-sm text-blue-700">{{ currentSession.totalFiles }} 枚の写真を分析済み</p>
          </div>
          <button
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold shadow-sm transition-colors"
            @click="step = 'select-faces'"
          >
            人物選択へ進む →
          </button>
        </div>

        <PhotoUploader :current-session-id="currentSession?.id" />

        <!-- Backup / Restore / Reset Actions -->
        <div class="mt-8 pt-4 border-t border-gray-100">
          <h3 class="text-sm font-semibold text-gray-500 mb-3">データ管理</h3>
          <div class="flex justify-end gap-3 flex-wrap">
            <button
              class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors flex items-center gap-2"
              @click="onExport"
            >
              <span class="i-lucide-download w-4 h-4" />
              バックアップを作成 (Export)
            </button>

            <button
              class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors flex items-center gap-2 relative"
              @click="triggerImport"
            >
              <span class="i-lucide-upload w-4 h-4" />
              バックアップから復元 (Import)
              <input
                ref="fileInput"
                type="file"
                accept=".json"
                class="hidden"
                @change="onImportFile"
              />
            </button>

            <button
              class="px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors ml-auto"
              @click="onClearPhotos"
            >
              写真のみ削除
            </button>
            <button
              class="px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors"
              @click="onResetDb"
            >
              データを初期化 (Reset DB)
            </button>
          </div>
        </div>
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
            <div class="aspect-video bg-gray-100 flex items-center justify-center">
              <span class="text-gray-500 text-xs p-2 text-center truncate">{{ photo.name }}</span>
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
