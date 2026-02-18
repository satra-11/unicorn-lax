<script setup lang="ts">
import { ref, watch, onMounted, toRaw, computed } from 'vue'
import type { FaceCluster, Photo } from '~/utils/types'
import { movePhotoToCluster } from '~/utils/clustering'
import { getPhoto, saveCluster } from '~/utils/db'

const props = defineProps<{
  cluster: FaceCluster
  sessionId: string
  isOpen: boolean
  allClusters: FaceCluster[]
}>()

const emit = defineEmits<{
  (e: 'close' | 'update'): void
}>()

const isLoading = ref(false)
const photos = ref<Photo[]>([])
const label = ref('')

const isUnrecognized = computed(() => props.cluster.id === 'unrecognized')

const loadData = async () => {
  if (!props.cluster || !props.isOpen) return

  isLoading.value = true
  try {
    // 1. Setup local state from cluster config
    label.value = props.cluster.label

    // 2. Load photos for this cluster
    const allIds = new Set([...props.cluster.photoIds, ...(props.cluster.confirmedPhotoIds || [])])
    const photoPromises = Array.from(allIds).map((id) => getPhoto(id))
    const results = await Promise.all(photoPromises)
    photos.value = results.filter((p): p is Photo => !!p)
  } catch (e) {
    console.error('Failed to load cluster data', e)
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadData()
})

watch(
  () => props.isOpen,
  (newVal) => {
    if (newVal) loadData()
  },
)

const saveSettings = async () => {
  if (isUnrecognized.value) {
    emit('close') // Just close for unrecognized
    return
  }

  // Save label
  const updated = structuredClone(toRaw(props.cluster))

  // Save label
  if (label.value !== props.cluster.label) {
    updated.label = label.value
  }

  try {
    await saveCluster(updated)
    emit('update')
  } catch (e: unknown) {
    console.error('Failed to save settings:', e)
    alert(`Failed to save settings: ${(e as Error).message}`)
  }
}

const moveTargetPhoto = ref<Photo | null>(null)
const showMoveModal = ref(false)

const openMoveModal = (photo: Photo) => {
  moveTargetPhoto.value = photo
  showMoveModal.value = true
}

const handleMove = async (targetClusterId: string) => {
  if (!moveTargetPhoto.value) return

  isLoading.value = true
  try {
    await movePhotoToCluster(moveTargetPhoto.value.id, props.cluster.id, targetClusterId)

    // Remove from local list immediately
    photos.value = photos.value.filter((p) => p.id !== moveTargetPhoto.value?.id)

    emit('update') // Parent refresh might be needed if centroids changed enough to affect other things, but mainly just to signal change.
    showMoveModal.value = false
    moveTargetPhoto.value = null
  } catch (e: unknown) {
    console.error('Failed to move photo', e)
    alert(`Failed to move photo: ${(e as Error).message}`)
  } finally {
    isLoading.value = false
  }
}

// Filter out current cluster from options
const targetClusters = computed(() => {
  return props.allClusters.filter((c) => c.id !== props.cluster.id)
})

const getPhotoUrl = (photo: Photo) => {
  // If we have a thumbnail blob, use it
  // In current types, Photo has `thumbnail` optional blob.
  // If not, maybe we can show just a placeholder or relative path text.
  if (photo.thumbnail) return URL.createObjectURL(photo.thumbnail)
  return '' // TODO: handle missing thumbnail better
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.isOpen" class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        @click="!isLoading && $emit('close')"
      ></div>

      <!-- Modal Content -->
      <div
        class="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto z-10 flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex justify-between items-center p-3 border-b sticky top-0 bg-white z-20">
          <h2 class="text-lg font-bold text-gray-900">
            {{ isUnrecognized ? '未検出の画像 (Unrecognized Photos)' : `編集: ${cluster.label}` }}
          </h2>
          <button
            class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
            @click="$emit('close')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-8 flex-1 overflow-y-auto">
          <!-- Label Editing -->
          <div v-if="!isUnrecognized">
            <label class="block text-sm font-medium text-gray-700 mb-1">名前</label>
            <input
              v-model="label"
              type="text"
              class="w-full border-gray-300 rounded-md shadow-sm focus:ring-[#FF6B6B] focus:border-[#FF6B6B] sm:text-sm px-3 py-2 border"
              placeholder="名前を入力"
            />
          </div>

          <!-- Feedback / Training -->
          <div>
            <div class="flex justify-between items-end mb-3">
              <div>
                <h3 class="text-sm font-semibold text-gray-900">
                  {{ isUnrecognized ? '画像一覧' : '分類された写真 (内訳)' }}
                </h3>
                <p v-if="!isUnrecognized" class="text-xs text-gray-500 mt-1">
                  間違って分類されている写真があれば、左上のアイコンから別の人物へ移動できます。
                </p>
                <p v-else class="text-xs text-gray-500 mt-1">顔が検出されなかった画像です。</p>
              </div>
            </div>

            <div
              class="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-80 overflow-y-auto border border-gray-200 p-3 rounded-lg bg-gray-50/50"
            >
              <div
                v-for="photo in photos"
                :key="photo.id"
                class="relative aspect-square cursor-pointer group rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md"
                :class="{ 'cursor-default': isUnrecognized }"
              >
                <img
                  v-if="photo.thumbnail"
                  :src="getPhotoUrl(photo)"
                  class="w-full h-full object-cover transition-opacity duration-200"
                  :class="isUnrecognized ? 'opacity-100' : 'opacity-100'"
                />
                <div
                  v-else
                  class="w-full h-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-400"
                >
                  No Img
                </div>

                <!-- Move Button (Top Left) -->
                <button
                  v-if="!isUnrecognized"
                  class="absolute top-1 left-1 bg-white/90 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-white hover:text-[#FF6B6B] shadow-sm"
                  title="Move to another person"
                  @click.stop="openMoveModal(photo)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 text-gray-600 hover:text-[#FF6B6B]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="p-3 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
          <button
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            @click="$emit('close')"
          >
            {{ isUnrecognized ? '閉じる' : 'キャンセル' }}
          </button>
          <button
            v-if="!isUnrecognized"
            class="px-4 py-2 text-sm font-medium text-white bg-gray-900 border border-transparent rounded-md hover:bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-colors shadow-sm"
            @click="saveSettings"
          >
            設定を保存
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showMoveModal && moveTargetPhoto"
      class="fixed inset-0 z-[10000] flex items-center justify-center p-4"
    >
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        @click="showMoveModal = false"
      ></div>
      <div class="relative bg-white rounded-lg shadow-xl max-w-sm w-full p-6 z-10">
        <h3 class="text-lg font-bold text-gray-900 mb-4">別の人物へ移動</h3>
        <p class="text-sm text-gray-600 mb-4">
          選択した写真を別の人物グループへ移動します。<br />
          移動後、両方のグループで顔モデルが再学習されます。
        </p>

        <div class="space-y-2 max-h-60 overflow-y-auto mb-4 border rounded p-2">
          <button
            v-for="target in targetClusters"
            :key="target.id"
            class="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-[#FFF5F0] hover:text-[#FF6B6B] rounded transition-colors flex items-center gap-2"
            @click="handleMove(target.id)"
          >
            <div class="w-6 h-6 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
              <!-- Simple thumbnail for target -->
              <!-- Using a reliable way to get thumbnail URL without complexity here, maybe skip or reuse helper if available in scope. We don't have helper easily accessible in loop context without wrapper, but let's try just label. -->
            </div>
            <span class="truncate font-medium">{{ target.label }}</span>
          </button>
          <div v-if="targetClusters.length === 0" class="text-center text-gray-400 py-4 text-sm">
            移動可能な他のグループがありません。
          </div>
        </div>

        <div class="flex justify-end">
          <button
            class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            @click="showMoveModal = false"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
