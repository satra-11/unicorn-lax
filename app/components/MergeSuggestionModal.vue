<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SimilarClusterPair } from '~/utils/clustering'
import { mergeClusters } from '~/utils/clustering'

const props = defineProps<{
  pairs: SimilarClusterPair[]
}>()

const emit = defineEmits<{
  (e: 'done'): void
}>()

const currentIndex = ref(0)
const isMerging = ref(false)

const currentPair = computed(() => props.pairs[currentIndex.value])

const totalPairs = computed(() => props.pairs.length)

const progress = computed(() => `${currentIndex.value + 1} / ${totalPairs.value}`)

const goNext = () => {
  if (currentIndex.value < totalPairs.value - 1) {
    currentIndex.value++
  } else {
    emit('done')
  }
}

const handleYes = async () => {
  const pair = currentPair.value
  if (!pair) return

  isMerging.value = true
  try {
    await mergeClusters(pair.clusterA.id, pair.clusterB.id)
  } catch (e) {
    console.error('Failed to merge clusters', e)
  } finally {
    isMerging.value = false
  }
  goNext()
}

const handleNo = () => {
  goNext()
}

const handleSkipAll = () => {
  emit('done')
}

const getThumbnailUrl = (blob?: Blob) => {
  if (!blob) return ''
  return URL.createObjectURL(blob)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="currentPair"
      class="fixed inset-0 z-[9999] flex items-center justify-center p-4"
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <!-- Modal -->
      <div
        class="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full z-10 overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        <!-- Header -->
        <div class="p-5 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-bold text-gray-900">
              「この2人は同一人物ですか？」
            </h2>
            <span class="text-sm text-gray-500 font-medium">
              {{ progress }}
            </span>
          </div>
        </div>

        <!-- Face Comparison -->
        <div class="p-6">
          <div class="flex items-center justify-center gap-6">
            <!-- Cluster A -->
            <div class="flex flex-col items-center gap-2 flex-1">
              <div class="w-24 h-24 rounded-full overflow-hidden bg-gray-100 ring-2 ring-blue-200 shadow-md">
                <img
                  v-if="currentPair.clusterA.thumbnail"
                  :src="getThumbnailUrl(currentPair.clusterA.thumbnail)"
                  class="w-full h-full object-cover"
                />
                <div
                  v-else
                  class="w-full h-full flex items-center justify-center text-gray-400 text-xs"
                >
                  No Img
                </div>
              </div>
              <span class="text-sm font-medium text-gray-800 truncate max-w-[120px]">
                {{ currentPair.clusterA.label }}
              </span>
              <span class="text-xs text-gray-500">
                {{ currentPair.clusterA.photoIds.length }} 枚
              </span>
            </div>

            <!-- VS Indicator -->
            <div class="flex flex-col items-center gap-1 shrink-0">
              <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <span class="text-sm font-bold text-gray-500">＝？</span>
              </div>
              <span class="text-[10px] text-gray-400">
                類似度: {{ (1 - currentPair.distance).toFixed(0) === '1' ? (1 - currentPair.distance).toFixed(2) : (1 - currentPair.distance).toFixed(2) }}
              </span>
            </div>

            <!-- Cluster B -->
            <div class="flex flex-col items-center gap-2 flex-1">
              <div class="w-24 h-24 rounded-full overflow-hidden bg-gray-100 ring-2 ring-indigo-200 shadow-md">
                <img
                  v-if="currentPair.clusterB.thumbnail"
                  :src="getThumbnailUrl(currentPair.clusterB.thumbnail)"
                  class="w-full h-full object-cover"
                />
                <div
                  v-else
                  class="w-full h-full flex items-center justify-center text-gray-400 text-xs"
                >
                  No Img
                </div>
              </div>
              <span class="text-sm font-medium text-gray-800 truncate max-w-[120px]">
                {{ currentPair.clusterB.label }}
              </span>
              <span class="text-xs text-gray-500">
                {{ currentPair.clusterB.photoIds.length }} 枚
              </span>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="p-5 border-t bg-gray-50 flex flex-col gap-3">
          <div class="flex gap-3">
            <button
              :disabled="isMerging"
              class="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors disabled:opacity-50"
              @click="handleNo"
            >
              いいえ
            </button>
            <button
              :disabled="isMerging"
              class="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors shadow-sm disabled:opacity-50"
              @click="handleYes"
            >
              {{ isMerging ? '統合中...' : 'はい' }}
            </button>
          </div>
          <button
            v-if="totalPairs > 1"
            class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            @click="handleSkipAll"
          >
            すべてスキップ
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
