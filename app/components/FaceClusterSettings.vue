<script setup lang="ts">
import { ref, watch, onMounted, toRaw, computed } from 'vue';
import type { FaceCluster, Photo } from '~/utils/types';
import { recalculateClusterCentroid } from '~/utils/clustering';
import { getPhoto, saveCluster, getPhotosBySession } from '~/utils/db';

const props = defineProps<{
  cluster: FaceCluster;
  sessionId: string;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update'): void; // When cluster updates
}>();

const isLoading = ref(false);
const photos = ref<Photo[]>([]);
const threshold = ref(0.4);

// We need to know which photos are "confirmed" vs just "auto-assigned"
const confirmedIds = ref<Set<string>>(new Set());


const isUnrecognized = computed(() => props.cluster.id === 'unrecognized');

const loadData = async () => {
    if (!props.cluster || !props.isOpen) return;
    
    isLoading.value = true;
    try {
        // 1. Setup local state from cluster config
        threshold.value = props.cluster.config?.similarityThreshold ?? 0.4;
        confirmedIds.value = new Set(props.cluster.confirmedPhotoIds || []);
        
        // 2. Load photos for this cluster
        // The cluster has photoIds. We need to fetch the actual Photo objects to display thumbnails.
        // We could fetch one by one, but if the session is cached it might be fast.
        // Or we might want to let the user "Search" for missed photos? 
        // For now, let's just show the CURRENTLY assigned ones + Confirmed ones (union).
        
        const allIds = new Set([...props.cluster.photoIds, ...(props.cluster.confirmedPhotoIds || [])]);
        const photoPromises = Array.from(allIds).map(id => getPhoto(id));
        const results = await Promise.all(photoPromises);
        photos.value = results.filter((p): p is Photo => !!p);
        
    } catch (e) {
        console.error('Failed to load cluster data', e);
    } finally {
        isLoading.value = false;
    }
};

watch(() => props.isOpen, (newVal) => {
    if (newVal) loadData();
});

const saveSettings = async () => {
    if (isUnrecognized.value) {
        emit('close'); // Just close for unrecognized
        return;
    }

    // Save threshold
    // structuredClone ensures we detach from Vue proxies/reactivity completely
    // and toRaw ensures we are cloning the plain object data
    const updated = structuredClone(toRaw(props.cluster));

    if (!updated.config) updated.config = {};
    updated.config.similarityThreshold = Number(threshold.value);
    
    // Save confirmed IDs
    updated.confirmedPhotoIds = Array.from(confirmedIds.value);
    
    await saveCluster(updated);
    emit('update');
};
// ... (skip down to template)

const triggerRecalculate = async () => {
    isLoading.value = true;
    try {
        // Ensure settings are saved first so confirm list is up to date
        await saveSettings();
        
        await recalculateClusterCentroid(props.cluster.id);
        emit('update'); // Cluster descriptor changed
        
        alert('Cluster updated! Future matches should be more accurate.');
    } catch (e) {
        console.error(e);
        alert('Failed to recalculate.');
    } finally {
        isLoading.value = false;
    }
};

const toggleConfirm = (photoId: string) => {
    if (confirmedIds.value.has(photoId)) {
        confirmedIds.value.delete(photoId);
    } else {
        confirmedIds.value.add(photoId);
    }
};

const getPhotoUrl = (photo: Photo) => {
    // If we have a thumbnail blob, use it
    // In current types, Photo has `thumbnail` optional blob.
    // If not, maybe we can show just a placeholder or relative path text.
    if (photo.thumbnail) return URL.createObjectURL(photo.thumbnail);
    return ''; // TODO: handle missing thumbnail better
};
</script>

<template>
  <Teleport to="body">
    <div v-if="props.isOpen" class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="!isLoading && $emit('close')"></div>

      <!-- Modal Content -->
      <div 
        class="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto z-10 flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex justify-between items-center p-6 border-b sticky top-0 bg-white z-20">
          <h2 class="text-xl font-bold text-gray-900">
              {{ isUnrecognized ? '未検出の画像 (Unrecognized Photos)' : `編集: ${cluster.label}` }}
          </h2>
          <button 
            @click="$emit('close')" 
            class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-8 flex-1 overflow-y-auto">
          <!-- Threshold Settings - Hidden for Unrecognized -->
          <div v-if="!isUnrecognized" class="bg-gray-50 p-5 rounded-lg border border-gray-100">
              <h3 class="text-sm font-semibold text-gray-900 mb-3">認識感度 (類似度しきい値)</h3>
              <div class="flex items-center gap-4">
                  <input 
                      type="range" 
                      min="0.1" 
                      max="0.8" 
                      step="0.05" 
                      v-model.number="threshold"
                      class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span class="text-sm font-mono font-medium text-gray-700 bg-white px-2 py-1 rounded border min-w-[3rem] text-center">{{ threshold }}</span>
              </div>
              <p class="text-xs text-gray-500 mt-2">
                  <span class="font-medium">低い (0.1)</span> = 厳しい (判定が慎重になる) <br/>
                  <span class="font-medium">高い (0.8)</span> = 緩い (判定が広くなる)
              </p>
          </div>

          <!-- Feedback / Training -->
          <div>
              <div class="flex justify-between items-end mb-3">
                  <div>
                      <h3 class="text-sm font-semibold text-gray-900">
                          {{ isUnrecognized ? '画像一覧' : '学習データ (フィードバック)' }}
                      </h3>
                      <p v-if="!isUnrecognized" class="text-xs text-gray-500 mt-1">
                          正しい写真をクリックして「確定(緑枠)」してください。<br>確定した写真を基に、AIがこの人の顔の特徴を再学習します。
                      </p>
                      <p v-else class="text-xs text-gray-500 mt-1">
                          顔が検出されなかった画像です。
                      </p>
                  </div>
                  <button 
                      v-if="!isUnrecognized"
                      @click="triggerRecalculate"
                      :disabled="isLoading"
                      class="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  >
                      {{ isLoading ? '計算中...' : '顔モデルを更新' }}
                  </button>
              </div>

              <div class="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-80 overflow-y-auto border border-gray-200 p-3 rounded-lg bg-gray-50/50">
                  <div 
                      v-for="photo in photos" 
                      :key="photo.id"
                      class="relative aspect-square cursor-pointer group rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md"
                      :class="{'cursor-default': isUnrecognized}"
                      @click="!isUnrecognized && toggleConfirm(photo.id)"
                  >
                      <img 
                          v-if="photo.thumbnail" 
                          :src="getPhotoUrl(photo)" 
                          class="w-full h-full object-cover transition-opacity duration-200"
                          :class="isUnrecognized ? 'opacity-100' : (confirmedIds.has(photo.id) ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 grayscale-[30%] group-hover:grayscale-0')"
                      />
                      <div v-else class="w-full h-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-400">
                          No Img
                      </div>

                      <!-- Selection Border Overlay -->
                      <div 
                        v-if="!isUnrecognized"
                        class="absolute inset-0 border-4 transition-colors duration-200 pointer-events-none"
                        :class="confirmedIds.has(photo.id) ? 'border-green-500' : 'border-transparent'"
                      ></div>

                      <!-- Checkmark Badge -->
                      <div 
                        v-if="!isUnrecognized && confirmedIds.has(photo.id)" 
                        class="absolute top-1 right-1 bg-green-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs shadow-sm z-10"
                      >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                          </svg>
                      </div>
                  </div>
              </div>
          </div>
        </div>

        <div class="p-6 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
          <button 
              @click="$emit('close')"
              class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
          >
              {{ isUnrecognized ? '閉じる' : 'キャンセル' }}
          </button>
          <button 
              v-if="!isUnrecognized"
              @click="saveSettings"
              class="px-4 py-2 text-sm font-medium text-white bg-gray-900 border border-transparent rounded-md hover:bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-colors shadow-sm"
          >
              設定を保存
          </button>
        </div>
      </div>
    </div>

  </Teleport>
</template>
