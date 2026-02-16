<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import type { FaceCluster, ProcessingSession } from '~/utils/types';
import { clusterFaces, getUnrecognizedPhotos } from '~/utils/clustering';
import { updateClusterLabel } from '~/utils/db';
import FaceClusterSettings from '~/components/FaceClusterSettings.vue';


const props = defineProps<{
  session: ProcessingSession;
}>();

const emit = defineEmits<{
  (e: 'select', clusters: FaceCluster[]): void;
}>();

const clusters = ref<FaceCluster[]>([]);
const selectedClusters = ref<Set<string>>(new Set());
const isLoading = ref(false);
const editingClusterId = ref<string | null>(null);
const editingLabel = ref('');
const editInputRef = ref<HTMLInputElement | null>(null);

// Settings Modal State
const showSettings = ref(false);
const settingsCluster = ref<FaceCluster | null>(null);

// Global Settings Modal State


    
    // Import the new function - we need to update imports first, but let's do logic here
    const loadClusters = async () => {
        if (!props.session) return;
        isLoading.value = true;
        try {
            const [detectedClusters, unrecognizedPhotos] = await Promise.all([
                clusterFaces(props.session.id),
                getUnrecognizedPhotos(props.session.id)
            ]);
            
            // Add unrecognized cluster if there are any photos
            if (unrecognizedPhotos.length > 0) {
                const unrecognizedCluster: FaceCluster = {
                    id: 'unrecognized',
                    label: '未検出 (Unrecognized)',
                    descriptor: new Float32Array(0), // Dummy
                    photoIds: unrecognizedPhotos.map(p => p.id),
                    // Use the first photo as thumbnail if available, otherwise it's fine
                    thumbnail: unrecognizedPhotos[0]?.thumbnail
                };
                // Append to end
                clusters.value = [...detectedClusters, unrecognizedCluster];
            } else {
                clusters.value = detectedClusters;
            }

        } catch (e) {
            console.error('Clustering failed', e);
        } finally {
            isLoading.value = false;
        }
    };

    const handleSettingsUpdate = async () => {
        await loadClusters(); // Reload data
        showSettings.value = false; // Close modal
    };


onMounted(loadClusters);
watch(() => props.session, loadClusters);

const toggleSelection = (cluster: FaceCluster) => {
    if (selectedClusters.value.has(cluster.id)) {
        selectedClusters.value.delete(cluster.id);
    } else {
        selectedClusters.value.add(cluster.id);
    }
    
    // Emit current selection
    const selected = clusters.value.filter(c => selectedClusters.value.has(c.id));
    emit('select', selected);
};

const startEditing = async (cluster: FaceCluster) => {
    editingClusterId.value = cluster.id;
    editingLabel.value = cluster.label;
    await nextTick();
    editInputRef.value?.focus();
    editInputRef.value?.select();
};

const handleEnter = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    (e.target as HTMLInputElement).blur();
};

const commitLabel = async (cluster: FaceCluster) => {
    const trimmed = editingLabel.value.trim();
    const newLabel = trimmed || cluster.label;

    // Update in local ref
    const target = clusters.value.find(c => c.id === cluster.id);
    if (target) {
        target.label = newLabel;
    }

    // Persist to DB
    await updateClusterLabel(cluster.id, newLabel);

    editingClusterId.value = null;
    editingLabel.value = '';
};

const openSettings = (cluster: FaceCluster) => {
    settingsCluster.value = cluster;
    showSettings.value = true;
};

const getThumbnailUrl = (cluster: FaceCluster) => {
    if (cluster.thumbnail) {
        return URL.createObjectURL(cluster.thumbnail);
    }
    return ''; // placeholder
};
</script>

<template>
  <div class="mt-8">
    <h3 class="text-lg font-semibold text-black mb-4">検出された人物</h3>

    <div v-if="isLoading" class="text-center py-4">顔を分類中...</div>
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
      <div 
        v-for="cluster in clusters" 
        :key="cluster.id"
        class="relative border-2 rounded-lg overflow-hidden transition-colors group/card"
        :class="selectedClusters.has(cluster.id) ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-300'"
      >
        <!-- Main Card Area - Opens Settings -->
        <div 
            class="cursor-pointer"
            @click="openSettings(cluster)"
        >
            <div class="aspect-square bg-gray-100 flex items-center justify-center relative">
                <img v-if="cluster.thumbnail" :src="getThumbnailUrl(cluster)" class="w-full h-full object-cover" />
                <span v-else class="text-gray-400 text-xs">No Img</span>
            </div>
            <div class="p-2 text-center">
                <!-- Inline label editing -->
                <div
                  v-if="editingClusterId === cluster.id"
                  @click.stop
                >
                  <input
                    ref="editInputRef"
                    v-model="editingLabel"
                    class="w-full text-xs font-medium text-center border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    @keydown.enter="handleEnter"
                    @blur="commitLabel(cluster)"
                  />
                </div>

                <div
                  v-else
                  class="flex items-center justify-center gap-1 cursor-text hover:bg-gray-50 rounded px-1 transition-colors"
                  @click.stop="startEditing(cluster)"
                >
                  <span class="text-xs font-medium truncate">{{ cluster.label }}</span>
                  <span class="text-gray-400 text-[10px]">✏️</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5">{{ cluster.photoIds.length }} 枚</div>
            </div>
        </div>

        <!-- Selection Checkbox (Top Right) -->
        <div 
            class="absolute top-1 right-1 z-10"
            @click.stop="toggleSelection(cluster)"
        >
            <div 
                class="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer shadow-sm"
                :class="selectedClusters.has(cluster.id) ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white/80 border-gray-300 hover:border-blue-400 text-transparent'"
            >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
            </div>
        </div>
      </div>
    </div>

    <!-- Settings Modal -->
    <FaceClusterSettings
        v-if="settingsCluster && showSettings"
        :cluster="settingsCluster"
        :session-id="props.session.id"
        :is-open="showSettings"
        @close="showSettings = false"
        @update="handleSettingsUpdate"
    />

  </div>
</template>

