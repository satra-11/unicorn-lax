<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { usePhotoProcessor } from '~/composables/usePhotoProcessor';
import FaceClusterSelector from '~/components/FaceClusterSelector.vue';
import AlbumPreview from '~/components/AlbumPreview.vue';
import type { FaceCluster, Photo } from '~/utils/types';
import { selectGroupBalancedPhotos, selectGrowthPhotos } from '~/utils/selection-algorithm';

const { isProcessing, progress, total, currentSession } = usePhotoProcessor();
const step = ref<'upload' | 'select-faces' | 'review' | 'confirmed'>('upload');
const selectedClusters = ref<FaceCluster[]>([]);
const generatedPhotos = ref<Photo[]>([]);
const mode = ref<'group' | 'growth'>('group');
const targetCount = ref(50);
const isSelecting = ref(false);

// Watch for processing completion to move to next step
watch(() => currentSession.value?.status, (newStatus) => {
    if (newStatus === 'completed') {
        step.value = 'select-faces';
    }
});

const onFacesSelected = (clusters: FaceCluster[]) => {
    selectedClusters.value = clusters;
};

const generateAlbum = async () => {
    if (!currentSession.value) return;
    isSelecting.value = true;
    try {
        if (mode.value === 'group') {
            generatedPhotos.value = await selectGroupBalancedPhotos(
              currentSession.value.id,
              selectedClusters.value,
              targetCount.value
            );
        } else {
            if (selectedClusters.value.length > 0) {
                generatedPhotos.value = await selectGrowthPhotos(
                  currentSession.value.id,
                  selectedClusters.value[0]!,
                  targetCount.value
                );
            }
        }
        step.value = 'review';
    } catch (e) {
        console.error('Selection failed', e);
    } finally {
        isSelecting.value = false;
    }
};

const onPhotosUpdated = (photos: Photo[]) => {
    generatedPhotos.value = photos;
};

const confirmedPhotos = computed(() =>
  generatedPhotos.value.filter(p => !p.excluded)
);

const confirmSelection = () => {
    step.value = 'confirmed';
};
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col items-center py-12">
    <h1 class="text-4xl font-bold text-gray-800 mb-8">Photo Selector</h1>

    <div class="w-full max-w-4xl px-4">
      <!-- Step 1: Upload -->
      <div v-if="step === 'upload' || isProcessing || (currentSession?.status === 'processing')" class="bg-white p-6 rounded shadow mb-6">
        <PhotoUploader />
      </div>

      <!-- Step 2: Select Faces -->
      <div v-if="step === 'select-faces' && currentSession" class="bg-white p-6 rounded shadow mb-6">
        <h2 class="text-xl font-bold mb-4 text-black">Select Target People</h2>

        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">Mode</label>
            <select v-model="mode" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
                <option value="group">Group Balance (Multiple Children)</option>
                <option value="growth">Individual Growth (Timeline Focus)</option>
            </select>
        </div>

        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">Target Photo Count</label>
            <input v-model.number="targetCount" type="number" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md" />
        </div>

        <p class="mb-4 text-gray-600 text-black">Select the child(ren) you want to include in the album.</p>

        <FaceClusterSelector
            :session="currentSession"
            @select="onFacesSelected"
        />

        <div class="mt-6 flex justify-end">
            <button
                @click="generateAlbum"
                :disabled="selectedClusters.length === 0 || isSelecting"
                class="px-6 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {{ isSelecting ? 'Generating...' : 'Generate Album' }}
            </button>
        </div>
      </div>

      <!-- Step 3: Review -->
      <div v-if="step === 'review'" class="bg-white p-6 rounded shadow mb-6">
          <h2 class="text-xl font-bold mb-2">Review Photos</h2>
          <p class="mb-4 text-sm text-gray-500">Click photos to include or exclude them. Photos without detected faces are shown separately so you can decide.</p>

          <AlbumPreview
            :photos="generatedPhotos"
            @update:photos="onPhotosUpdated"
          />

          <div class="mt-6 flex justify-between items-center">
              <button @click="step = 'select-faces'" class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50">Back</button>
              <button
                @click="confirmSelection"
                class="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Confirm Selection ({{ confirmedPhotos.length }} photos)
              </button>
          </div>
      </div>

      <!-- Step 4: Confirmed -->
      <div v-if="step === 'confirmed'" class="bg-white p-6 rounded shadow mb-6">
          <h2 class="text-xl font-bold mb-2">Selection Confirmed</h2>
          <p class="mb-4 text-gray-600">{{ confirmedPhotos.length }} photos finalized.</p>

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
              <button @click="step = 'review'" class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50">Back to Review</button>
          </div>
      </div>

    </div>
  </div>
</template>
