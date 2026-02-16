<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { usePhotoProcessor } from '~/composables/usePhotoProcessor';
import FaceClusterSelector from '~/components/FaceClusterSelector.vue';
import AlbumPreview from '~/components/AlbumPreview.vue';
import type { FaceCluster, Photo } from '~/utils/types';
import { selectGroupBalancedPhotos, selectGrowthPhotos } from '~/utils/selection-algorithm';
import { clearExisitingData } from '~/utils/db';

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

const onResetDb = async () => {
    if (confirm('全てのデータを消去しますか？この操作は取り消せません。')) {
        await clearExisitingData();
        window.location.reload();
    }
};
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col items-center py-12">
    <h1 class="text-4xl font-bold text-gray-800 mb-8">Unicorn Lax</h1>

    <div class="w-full max-w-4xl px-4">
      <!-- Step 1: Upload -->
      <div v-if="step === 'upload' || isProcessing || (currentSession?.status === 'processing')" class="bg-white p-6 rounded shadow mb-6">
        <PhotoUploader />
        <div class="mt-4 flex justify-end">
             <button @click="onResetDb" class="text-sm text-red-500 hover:underline">Reset Database</button>
        </div>
      </div>

      <!-- Step 2: Select Faces -->
      <div v-if="step === 'select-faces' && currentSession" class="bg-white p-6 rounded shadow mb-6">
        <h2 class="text-xl font-bold mb-4 text-black">対象の人物を選択</h2>

        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">モード選択</label>
            <select v-model="mode" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
                <option value="group">グループバランス (複数人のバランス重視)</option>
                <option value="growth">成長記録 (特定の1人の時系列)</option>
            </select>
        </div>

        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700">選定枚数 (目標)</label>
            <input v-model.number="targetCount" type="number" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md" />
        </div>

        <p class="mb-4 text-gray-600 text-black">アルバムに入れたい人物を選択してください。</p>

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
                {{ isSelecting ? '生成中...' : 'アルバム候補を生成' }}
            </button>
        </div>
      </div>

      <!-- Step 3: Review -->
      <div v-if="step === 'review'" class="bg-white p-6 rounded shadow mb-6">
          <h2 class="text-xl font-bold mb-2">写真の確認・調整</h2>
          <p class="mb-4 text-sm text-gray-500">クリックして除外/追加を切り替えられます。顔が検出されなかった写真も下に表示されています。</p>

          <AlbumPreview
            :photos="generatedPhotos"
            @update:photos="onPhotosUpdated"
          />

          <div class="mt-6 flex justify-between items-center">
              <button @click="step = 'select-faces'" class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50">戻る</button>
              <button
                @click="confirmSelection"
                class="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                選択を確定する ({{ confirmedPhotos.length }} 枚)
              </button>
          </div>
      </div>

      <!-- Step 4: Confirmed -->
      <div v-if="step === 'confirmed'" class="bg-white p-6 rounded shadow mb-6">
          <h2 class="text-xl font-bold mb-2">選定完了</h2>
          <p class="mb-4 text-gray-600">{{ confirmedPhotos.length }} 枚の写真を確定しました。</p>

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
              <button @click="step = 'review'" class="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50">確認画面に戻る</button>
          </div>
      </div>

    </div>
  </div>
</template>
