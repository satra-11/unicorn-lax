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
const selectedTargetClusterId = ref<string | null>(null)

const openMoveModal = (photo: Photo) => {
  moveTargetPhoto.value = photo
  selectedTargetClusterId.value = null // reset selection
  showMoveModal.value = true
}

const handleMove = async () => {
  if (!moveTargetPhoto.value || !selectedTargetClusterId.value) return

  isLoading.value = true
  try {
    const targetClusterId = selectedTargetClusterId.value
    await movePhotoToCluster(moveTargetPhoto.value.id, props.cluster.id, targetClusterId)

    // Remove from local list immediately
    photos.value = photos.value.filter((p) => p.id !== moveTargetPhoto.value?.id)

    emit('update') // Parent refresh might be needed if centroids changed enough to affect other things, but mainly just to signal change.
    showMoveModal.value = false
    moveTargetPhoto.value = null
    selectedTargetClusterId.value = null
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

const getThumbnailUrl = (cluster: FaceCluster) => {
  if (cluster.thumbnail) {
    return URL.createObjectURL(cluster.thumbnail)
  }
  return ''
}

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
            {{ isUnrecognized ? '顔が見つからなかった写真' : `${cluster.label} の写真` }}
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
                  {{ isUnrecognized ? '写真の一覧' : 'このグループの写真' }}
                </h3>
                <p v-if="!isUnrecognized" class="text-sm text-gray-600 mt-1">
                  違う人の写真がまざっていたら、写真の右下にある「移動する」ボタンから正しい人のグループへ移動できます。
                </p>
                <p v-else class="text-sm text-gray-600 mt-1">顔が見つからなかった写真です。</p>
              </div>
            </div>

            <div
              class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[50vh] overflow-y-auto border border-gray-200 p-4 rounded-xl bg-gray-50"
            >
              <div
                v-for="photo in photos"
                :key="photo.id"
                class="relative aspect-square rounded-xl overflow-hidden shadow-sm border border-gray-200 transition-all hover:shadow-md bg-white"
                :class="{ 'cursor-default': isUnrecognized }"
              >
                <img
                  v-if="photo.thumbnail"
                  :src="getPhotoUrl(photo)"
                  class="w-full h-full object-cover transition-opacity duration-200"
                />
                <div
                  v-else
                  class="w-full h-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-400"
                >
                  No Image
                </div>

                <!-- Move Button (Always visible) -->
                <button
                  v-if="!isUnrecognized"
                  class="absolute bottom-2 right-2 bg-white/95 text-gray-700 hover:text-[#FF6B6B] hover:border-[#FFD4C4] px-3 py-2 rounded-lg z-20 shadow border border-gray-200 font-bold text-xs flex items-center gap-1.5 transition-colors"
                  title="別の人のグループへ移動"
                  @click.stop="openMoveModal(photo)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                    />
                  </svg>
                  移動する
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
            保存する
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
      <div class="relative bg-white rounded-2xl shadow-xl max-w-4xl w-full p-6 z-10 flex flex-col md:flex-row gap-8 max-h-[90vh]">
        
        <!-- Left: Image Preview -->
        <div class="w-full md:w-1/2 flex flex-col">
          <h3 class="text-xl font-bold text-gray-900 mb-2">この写真を移動します</h3>
          <p class="text-sm text-gray-600 mb-4">
            別の人のグループへ移動すると、AIが自動的に他の写真も再調整します。
          </p>
          <div class="relative w-full aspect-square rounded-2xl overflow-hidden bg-gray-100 border border-gray-200">
            <img
              v-if="moveTargetPhoto.thumbnail"
              :src="getPhotoUrl(moveTargetPhoto)"
              class="w-full h-full object-contain"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-gray-400">
              No Image
            </div>
          </div>
        </div>

        <!-- Right: Target Selection -->
        <div class="w-full md:w-1/2 flex flex-col flex-1 min-h-0">
          <h3 class="text-xl font-bold text-gray-900 mb-4">移動先を選んでください</h3>
          
          <div class="space-y-3 overflow-y-auto flex-1 mb-6 p-2 bg-gray-50 rounded-xl">
            <button
              v-for="target in targetClusters"
              :key="target.id"
              class="w-full text-left p-4 text-base rounded-xl transition-all flex items-center gap-6 bg-white border shadow-sm hover:shadow-md"
              :class="
                selectedTargetClusterId === target.id
                  ? 'border-[#FF6B6B] bg-[#FFF5F0] text-[#FF6B6B] font-bold ring-2 ring-[#FF6B6B]'
                  : 'border-gray-200 text-gray-700'
              "
              @click="selectedTargetClusterId = target.id"
            >
              <div class="w-20 h-20 md:w-24 md:h-24 bg-gray-200 rounded-full overflow-hidden flex-shrink-0 border-[3px] border-white shadow-sm">
                <img
                  v-if="target.thumbnail"
                  :src="getThumbnailUrl(target)"
                  class="w-full h-full object-cover"
                />
              </div>
              <span class="truncate flex-1 font-bold text-xl md:text-2xl">{{ target.label }}</span>
              <div
                class="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors shrink-0"
                :class="
                  selectedTargetClusterId === target.id
                    ? 'bg-[#FF6B6B] border-[#FF6B6B] text-white'
                    : 'bg-white border-gray-300'
                "
              >
                <svg v-if="selectedTargetClusterId === target.id" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </button>
            <div v-if="targetClusters.length === 0" class="text-center text-gray-500 py-8 font-medium">
              移動できるグループがありません。
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-2">
            <button
              class="px-5 py-3 text-sm font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              @click="showMoveModal = false"
            >
              キャンセル
            </button>
            <button
              class="px-6 py-3 text-sm font-bold text-white bg-[#FF6B6B] rounded-xl hover:bg-[#e55a5a] shadow-lg shadow-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              :disabled="!selectedTargetClusterId"
              @click="handleMove"
            >
              移動する
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
