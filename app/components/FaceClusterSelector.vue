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
    <h3 class="text-lg font-semibold mb-4 text-black">検出された人物</h3>
    <div v-if="isLoading" class="text-center py-4">顔を分類中...</div>
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
      <div 
        v-for="cluster in clusters" 
        :key="cluster.id"
        class="relative border-2 rounded-lg overflow-hidden cursor-pointer transition-colors group/card"
        :class="selectedClusters.has(cluster.id) ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-300'"
        @click="toggleSelection(cluster)"
      >
        <div class="aspect-square bg-gray-100 flex items-center justify-center relative">
            <img v-if="cluster.thumbnail" :src="getThumbnailUrl(cluster)" class="w-full h-full object-cover" />
            <span v-else class="text-gray-400 text-xs">No Img</span>
            
            <!-- Settings Button (Visible on Hover) -->
            <button 
                @click.stop="openSettings(cluster)"
                class="absolute top-1 left-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover/card:opacity-100 transition-opacity"
                title="詳細設定"
            >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
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
                @keydown.enter="commitLabel(cluster)"
                @blur="commitLabel(cluster)"
              />
            </div>
            <div
              v-else
              class="flex items-center justify-center gap-1 group"
              @click.stop="startEditing(cluster)"
            >
              <span class="text-xs font-medium truncate">{{ cluster.label }}</span>
              <span class="text-gray-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
            </div>
            <div class="text-[10px] text-gray-400 mt-0.5">{{ cluster.photoIds.length }} 枚</div>
        </div>
        <div v-if="selectedClusters.has(cluster.id)" class="absolute top-1 right-1 bg-blue-500 text-black rounded-full w-5 h-5 flex items-center justify-center text-xs">
            ✓
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
        @update="loadClusters"
    />
  </div>
</template>

