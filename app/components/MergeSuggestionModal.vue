<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SimilarClusterPair } from '~/utils/clustering'
import { mergeClusters } from '~/utils/clustering'

const props = defineProps<{
  pairs: SimilarClusterPair[]
}>()

const emit = defineEmits<{
  (e: 'done', dismissed: Array<{ idA: string; idB: string }>): void
}>()

const currentIndex = ref(0)
const isMerging = ref(false)
const dismissedPairs = ref<Array<{ idA: string; idB: string }>>([])

const currentPair = computed(() => props.pairs[currentIndex.value])

const totalPairs = computed(() => props.pairs.length)

const progress = computed(() => `${currentIndex.value + 1} / ${totalPairs.value}`)

const similarityPercent = computed(() => {
  if (!currentPair.value) return 0
  return Math.round((1 - currentPair.value.distance) * 100)
})

const finish = () => {
  emit('done', dismissedPairs.value)
}

const goNext = () => {
  if (currentIndex.value < totalPairs.value - 1) {
    currentIndex.value++
  } else {
    finish()
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
  const pair = currentPair.value
  if (pair) {
    dismissedPairs.value.push({ idA: pair.clusterA.id, idB: pair.clusterB.id })
  }
  goNext()
}

const handleSkipAll = () => {
  // Dismiss all remaining pairs
  for (let i = currentIndex.value; i < totalPairs.value; i++) {
    const pair = props.pairs[i]
    if (pair) {
      dismissedPairs.value.push({ idA: pair.clusterA.id, idB: pair.clusterB.id })
    }
  }
  finish()
}

const getThumbnailUrl = (blob?: Blob) => {
  if (!blob) return ''
  return URL.createObjectURL(blob)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="currentPair" class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />

      <!-- Modal -->
      <div
        class="relative bg-white rounded-2xl shadow-2xl max-w-md w-full z-10 overflow-hidden animate-fade-in"
        role="dialog"
        aria-modal="true"
      >
        <!-- Progress Bar -->
        <div class="h-1 bg-gray-100">
          <div
            class="h-full bg-gradient-to-r from-[#FF6B6B] to-[#FF8E53] transition-all duration-300"
            :style="{ width: `${((currentIndex + 1) / totalPairs) * 100}%` }"
          />
        </div>

        <!-- Header -->
        <div class="px-6 pt-5 pb-4">
          <div class="flex justify-between items-start">
            <div>
              <h2 class="text-base font-bold text-gray-900">「この2人は同一人物ですか？」</h2>
            </div>
            <button
              class="text-gray-300 hover:text-gray-500 transition-colors p-1 -mr-1 -mt-1"
              @click="handleSkipAll"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
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
        </div>

        <!-- Face Comparison -->
        <div class="px-6 pb-5">
          <div class="flex items-start justify-center gap-4">
            <!-- Cluster A -->
            <div class="flex flex-col items-center gap-2.5 flex-1 min-w-0">
              <div class="relative">
                <div
                  class="w-20 h-20 rounded-2xl overflow-hidden bg-gray-100 ring-2 ring-[#FFD4C4] shadow-lg"
                >
                  <img
                    v-if="currentPair.clusterA.thumbnail"
                    :src="getThumbnailUrl(currentPair.clusterA.thumbnail)"
                    class="w-full h-full object-cover"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center text-gray-300">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-8 w-8"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
              <div class="text-center min-w-0 w-full">
                <p class="text-sm font-semibold text-gray-800 truncate">
                  {{ currentPair.clusterA.label }}
                </p>
                <p class="text-[11px] text-gray-400">
                  {{ currentPair.clusterA.photoIds.length }} 枚
                </p>
              </div>
            </div>

            <!-- Similarity Badge -->
            <div class="flex flex-col items-center gap-1.5 pt-5 shrink-0">
              <div
                class="w-12 h-12 rounded-full flex items-center justify-center shadow-inner"
                :class="
                  similarityPercent >= 60
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-gray-50 text-gray-500'
                "
              >
                <span class="text-xs font-bold">{{ similarityPercent }}%</span>
              </div>
              <span class="text-[10px] text-gray-400 font-medium">類似度</span>
            </div>

            <!-- Cluster B -->
            <div class="flex flex-col items-center gap-2.5 flex-1 min-w-0">
              <div class="relative">
                <div
                  class="w-20 h-20 rounded-2xl overflow-hidden bg-gray-100 ring-2 ring-[#FFDBC4] shadow-lg"
                >
                  <img
                    v-if="currentPair.clusterB.thumbnail"
                    :src="getThumbnailUrl(currentPair.clusterB.thumbnail)"
                    class="w-full h-full object-cover"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center text-gray-300">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-8 w-8"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
              <div class="text-center min-w-0 w-full">
                <p class="text-sm font-semibold text-gray-800 truncate">
                  {{ currentPair.clusterB.label }}
                </p>
                <p class="text-[11px] text-gray-400">
                  {{ currentPair.clusterB.photoIds.length }} 枚
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="px-6 pb-5">
          <div class="flex gap-3">
            <button
              :disabled="isMerging"
              class="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 active:scale-[0.98] focus:outline-none transition-all disabled:opacity-50"
              @click="handleNo"
            >
              いいえ
            </button>
            <button
              :disabled="isMerging"
              class="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#FF6B6B] to-[#FF8E53] rounded-xl hover:from-[#e55a5a] hover:to-[#e57c48] active:scale-[0.98] focus:outline-none shadow-md shadow-orange-200/50 transition-all disabled:opacity-50"
              @click="handleYes"
            >
              {{ isMerging ? '統合中...' : 'はい' }}
            </button>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 pb-4 flex justify-between items-center">
          <span class="text-[11px] text-gray-300">{{ progress }}</span>
          <button
            v-if="totalPairs > 1"
            class="text-[11px] text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
            @click="handleSkipAll"
          >
            残りをスキップ
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
