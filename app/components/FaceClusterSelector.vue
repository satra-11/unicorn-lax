<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { FaceCluster, ProcessingSession } from '~/utils/types';
import { clusterFaces } from '~/utils/clustering';
// import { saveSession } from '~/utils/db'; // Might update session with selected faces

const props = defineProps<{
  session: ProcessingSession;
}>();

const emit = defineEmits<{
  (e: 'select', clusters: FaceCluster[]): void;
}>();

const clusters = ref<FaceCluster[]>([]);
const selectedClusters = ref<Set<string>>(new Set());
const isLoading = ref(false);

const loadClusters = async () => {
    if (!props.session) return;
    isLoading.value = true;
    try {
        clusters.value = await clusterFaces(props.session.id);
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

const getThumbnailUrl = (cluster: FaceCluster) => {
    if (cluster.thumbnail) {
        return URL.createObjectURL(cluster.thumbnail);
    }
    return ''; // placeholder
};
</script>

<template>
  <div class="mt-8">
    <h3 class="text-lg font-semibold mb-4">Detected People</h3>
    <div v-if="isLoading" class="text-center py-4">Clustering faces...</div>
    <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
      <div 
        v-for="cluster in clusters" 
        :key="cluster.id"
        class="relative border-2 rounded-lg overflow-hidden cursor-pointer transition-colors"
        :class="selectedClusters.has(cluster.id) ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-300'"
        @click="toggleSelection(cluster)"
      >
        <div class="aspect-square bg-gray-100 flex items-center justify-center">
            <img v-if="cluster.thumbnail" :src="getThumbnailUrl(cluster)" class="w-full h-full object-cover" />
            <span v-else class="text-gray-400 text-xs">No Img</span>
        </div>
        <div class="p-2 text-center text-xs font-medium truncate">
            {{ cluster.photoIds.length }} photos
        </div>
        <div v-if="selectedClusters.has(cluster.id)" class="absolute top-1 right-1 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
            ✓
        </div>
      </div>
    </div>
  </div>
</template>
