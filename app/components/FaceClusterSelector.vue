<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { FaceCluster, ProcessingSession } from '~/utils/types'
import {
  clusterFaces,
  getUnrecognizedPhotos,
  findSimilarClusterPairs,
  type SimilarClusterPair,
} from '~/utils/clustering'
import { updateClusterLabel } from '~/utils/db'
import FaceClusterSettings from '~/components/FaceClusterSettings.vue'
import MergeSuggestionModal from '~/components/MergeSuggestionModal.vue'

// Persist dismissed merge pair keys in localStorage so they survive page reloads
const DISMISSED_MERGE_PAIRS_KEY = 'dismissed-merge-pairs'

const loadDismissedPairs = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DISMISSED_MERGE_PAIRS_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

const saveDismissedPair = (key: string) => {
  const set = loadDismissedPairs()
  set.add(key)
  localStorage.setItem(DISMISSED_MERGE_PAIRS_KEY, JSON.stringify([...set]))
}

const makePairKey = (idA: string, idB: string) => [idA, idB].sort().join(':')

const props = defineProps<{
  session: ProcessingSession
  singleSelection?: boolean
  hideSelection?: boolean
  selectionOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', clusters: FaceCluster[]): void
}>()

const clusters = ref<FaceCluster[]>([])
const selectedClusters = ref<Set<string>>(new Set())
const isLoading = ref(false)
const editingClusterId = ref<string | null>(null)
const editingLabel = ref('')

// Settings Modal State
const showSettings = ref(false)
const settingsCluster = ref<FaceCluster | null>(null)

// Merge Suggestion State
const similarPairs = ref<SimilarClusterPair[]>([])
const showMergeSuggestion = ref(false)

const loadClusters = async () => {
  if (!props.session) return
  isLoading.value = true
  try {
    const [detectedClusters, unrecognizedPhotos] = await Promise.all([
      clusterFaces(props.session.id),
      getUnrecognizedPhotos(props.session.id),
    ])

    if (unrecognizedPhotos.length > 0) {
      const unrecognizedCluster: FaceCluster = {
        id: 'unrecognized',
        label: '未検出 (Unrecognized)',
        descriptor: new Float32Array(0),
        photoIds: unrecognizedPhotos.map((p) => p.id),
        thumbnail: unrecognizedPhotos[0]?.thumbnail,
      }
      clusters.value = [...detectedClusters, unrecognizedCluster]
    } else {
      clusters.value = detectedClusters
    }
  } catch (e) {
    console.error('Clustering failed', e)
  } finally {
    isLoading.value = false
  }
}

const checkMergeSuggestions = () => {
  const dismissed = loadDismissedPairs()
  const allPairs = findSimilarClusterPairs(clusters.value)
  const newPairs = allPairs.filter((p) => !dismissed.has(makePairKey(p.clusterA.id, p.clusterB.id)))
  if (newPairs.length > 0) {
    similarPairs.value = newPairs
    showMergeSuggestion.value = true
  }
}

const handleSettingsUpdate = async () => {
  await loadClusters()
  showSettings.value = false
}

const handleMergeDone = async (dismissed: Array<{ idA: string; idB: string }>) => {
  showMergeSuggestion.value = false
  similarPairs.value = []
  for (const d of dismissed) {
    saveDismissedPair(makePairKey(d.idA, d.idB))
  }
  await loadClusters()
}

onMounted(async () => {
  await loadClusters()
  checkMergeSuggestions()
})
watch(
  () => props.session,
  async () => {
    await loadClusters()
    checkMergeSuggestions()
  },
)

// Watch for singleSelection prop change to enforce valid state
watch(
  () => props.singleSelection,
  (isSingle) => {
    if (isSingle && selectedClusters.value.size > 1) {
      // Keep only the most recently added or just clear all but one.
      // Since Set doesn't track order reliably in all envs (though usually insertion order),
      // let's just keep the first one found.
      const first = selectedClusters.value.values().next().value
      selectedClusters.value.clear()
      if (first) {
        selectedClusters.value.add(first)
        emitSelection()
      } else {
        emitSelection()
      }
    }
  },
)

const emitSelection = () => {
  const selected = clusters.value.filter((c) => selectedClusters.value.has(c.id))
  emit('select', selected)
}

const toggleSelection = (cluster: FaceCluster) => {
  if (selectedClusters.value.has(cluster.id)) {
    selectedClusters.value.delete(cluster.id)
  } else {
    if (props.singleSelection) {
      selectedClusters.value.clear()
    }
    selectedClusters.value.add(cluster.id)
  }

  emitSelection()
}

const setEditInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement && editingClusterId.value) {
    el.focus()
    el.select()
  }
}

const startEditing = async (cluster: FaceCluster) => {
  editingClusterId.value = cluster.id
  editingLabel.value = cluster.label
  // Focus will happen via :ref callback when element renders
}

const handleEnter = (e: KeyboardEvent) => {
  if (e.isComposing) return
  ;(e.target as HTMLInputElement).blur()
}

const commitLabel = async (cluster: FaceCluster) => {
  const trimmed = editingLabel.value.trim()
  const newLabel = trimmed || cluster.label

  // Update in local ref
  const target = clusters.value.find((c) => c.id === cluster.id)
  if (target) {
    target.label = newLabel
  }

  // Persist to DB
  await updateClusterLabel(cluster.id, newLabel)

  editingClusterId.value = null
  editingLabel.value = ''
}

const openSettings = (cluster: FaceCluster) => {
  settingsCluster.value = cluster
  showSettings.value = true
}

const getThumbnailUrl = (cluster: FaceCluster) => {
  if (cluster.thumbnail) {
    return URL.createObjectURL(cluster.thumbnail)
  }
  return '' // placeholder
}
</script>

<template>
  <div class="mt-8">
    <h3 class="text-lg font-semibold text-black mb-4">見つかった人</h3>

    <div v-if="isLoading" class="text-center py-4">人物を整理しています...</div>
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
      <div
        v-for="cluster in clusters"
        :key="cluster.id"
        class="relative border-2 rounded-lg overflow-hidden transition-colors group/card"
        :class="
          selectedClusters.has(cluster.id)
            ? 'border-[#FF6B6B] ring-2 ring-[#FFB5B5]'
            : 'border-gray-200 hover:border-[#FFB5B5]'
        "
      >
        <!-- Main Card Area -->
        <div class="cursor-pointer" @click="props.selectionOnly ? toggleSelection(cluster) : openSettings(cluster)">
          <div class="aspect-square bg-gray-100 flex items-center justify-center relative">
            <img
              v-if="cluster.thumbnail"
              :src="getThumbnailUrl(cluster)"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-gray-400 text-xs">No Img</span>
          </div>
          <div class="p-2 text-center">
            <div v-if="!props.selectionOnly && editingClusterId === cluster.id" @click.stop>
              <input
                :ref="setEditInputRef"
                v-model="editingLabel"
                class="w-full text-xs font-medium text-center border border-[#FF6B6B] rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#FF6B6B]"
                @keydown.enter="handleEnter"
                @blur="commitLabel(cluster)"
              />
            </div>

            <div
              v-else
              class="flex items-center justify-center gap-1 rounded px-1 transition-colors"
              :class="props.selectionOnly ? '' : 'cursor-text hover:bg-gray-50'"
              @click.stop="!props.selectionOnly && startEditing(cluster)"
            >
              <span class="text-xs font-medium truncate">{{ cluster.label }}</span>
            </div>
            <div class="text-[12px] text-gray-400 mt-0.5">{{ cluster.photoIds.length }} 枚</div>
          </div>
        </div>

        <!-- Selection Checkbox (Top Right) -->
        <div v-if="!props.hideSelection" class="absolute top-1 right-1 z-10" @click.stop="toggleSelection(cluster)">
          <div
            class="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer shadow-sm"
            :class="
              selectedClusters.has(cluster.id)
                ? 'bg-[#FF6B6B] border-[#FF6B6B] text-white'
                : 'bg-white/80 border-gray-300 hover:border-[#FF6B6B] text-transparent'
            "
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Merge Suggestion Modal -->
    <MergeSuggestionModal
      v-if="showMergeSuggestion && similarPairs.length > 0"
      :pairs="similarPairs"
      @done="handleMergeDone"
    />

    <!-- Settings Modal -->
    <FaceClusterSettings
      v-if="settingsCluster && showSettings"
      :cluster="settingsCluster"
      :session-id="props.session.id"
      :is-open="showSettings"
      :all-clusters="clusters"
      @close="showSettings = false"
      @update="handleSettingsUpdate"
    />
  </div>
</template>
