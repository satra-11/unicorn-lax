<script setup lang="ts">
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'

const props = defineProps<{
  currentSessionId?: string
}>()

const { processFiles, isProcessing, progress, total, currentSession, faceModel, setFaceModel, processingStatus } =
  usePhotoProcessor()

const onFolderSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    await processFiles(input.files, props.currentSessionId)
  }
}
</script>

<template>
  <div class="p-6 bg-white rounded-lg shadow-md">
    <div
      v-if="(!isProcessing && !currentSession?.status) || currentSession?.status === 'completed'"
      class="text-center"
    >
      <h2 class="text-xl font-bold mb-4 text-black">AIモードの選択</h2>

      <!-- Model Selection -->
      <div class="mb-6 max-w-md mx-auto text-left">
        <div class="grid grid-cols-2 gap-3">
          <!-- 🦄 Unicorn Mode -->
          <label
            class="model-card unicorn-card"
            :class="{ 'model-card-active': faceModel === 'ssd' }"
          >
            <input
              type="radio"
              name="faceModel"
              value="ssd"
              :checked="faceModel === 'ssd'"
              class="sr-only"
              @change="setFaceModel('ssd')"
            />
            <span class="model-card-badge unicorn-badge">推奨</span>
            <div class="model-card-icon">🦄</div>
            <div class="model-card-name">Unicornモード</div>
            <div class="model-card-desc">精度を重視し、<br />ほとんどの写真に対応</div>
          </label>

          <!-- 🐇 Rabbit Mode -->
          <label
            class="model-card rabbit-card"
            :class="{ 'model-card-active': faceModel === 'tiny' }"
          >
            <input
              type="radio"
              name="faceModel"
              value="tiny"
              :checked="faceModel === 'tiny'"
              class="sr-only"
              @change="setFaceModel('tiny')"
            />
            <div class="model-card-icon">🐇</div>
            <div class="model-card-name">Rabbitモード</div>
            <div class="model-card-desc">スピード重視、<br />精度はやや控えめ</div>
          </label>
        </div>
      </div>

      <label
        class="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        <span class="mr-2">フォルダを選択</span>
        <input
          type="file"
          webkitdirectory
          directory
          multiple
          class="hidden"
          @change="onFolderSelect"
        />
      </label>
    </div>

    <div
      v-if="isProcessing || (currentSession && currentSession.status === 'processing')"
      class="mt-4"
    >
      <h3 class="font-semibold text-lg mb-2 text-black">処理中...</h3>
      <div class="w-full bg-gray-200 rounded-full h-4 mb-2">
        <div
          class="bg-blue-600 h-4 rounded-full transition-all duration-300"
          :style="{ width: `${(progress / total) * 100}%` }"
        ></div>
      </div>
      <p class="text-sm text-gray-600 text-center">{{ progress }} / {{ total }}</p>
      <p v-if="processingStatus" class="text-sm text-blue-600 text-center mt-2 animate-pulse">
        {{ processingStatus }}
      </p>
      <p v-else-if="progress === 0" class="text-sm text-gray-500 text-center mt-2">
        準備中...
      </p>
    </div>
  </div>
</template>

<style scoped>
.model-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.25rem 1rem;
  border: 2px solid #e5e7eb;
  border-radius: 1rem;
  cursor: pointer;
  transition: all 0.25s ease;
  background: white;
}

.model-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

/* Unicorn card accent */
.unicorn-card.model-card-active {
  border-color: #a78bfa;
  background: linear-gradient(135deg, #f5f3ff 0%, #fdf2f8 100%);
  box-shadow: 0 4px 16px rgba(167, 139, 250, 0.2);
}

/* Rabbit card accent */
.rabbit-card.model-card-active {
  border-color: #fb923c;
  background: linear-gradient(135deg, #fffbeb 0%, #fff7ed 100%);
  box-shadow: 0 4px 16px rgba(251, 146, 60, 0.2);
}

.model-card-badge {
  position: absolute;
  top: -0.5rem;
  right: -0.25rem;
  padding: 0.125rem 0.5rem;
  font-size: 1rem;
  font-weight: 700;
  border-radius: 9999px;
  letter-spacing: 0.025em;
}

.unicorn-badge {
  background: linear-gradient(135deg, #a78bfa, #f472b6);
  color: white;
  box-shadow: 0 2px 8px rgba(167, 139, 250, 0.3);
}

.model-card-icon {
  font-size: 2.25rem;
  line-height: 1;
  margin-bottom: 0.25rem;
  transition: transform 0.25s ease;
}

.model-card:hover .model-card-icon {
  transform: scale(1.15);
}

.model-card-name {
  font-size: 0.95rem;
  font-weight: 800;
  color: #1f2937;
  letter-spacing: 0.025em;
}

.model-card-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: #9ca3af;
  margin-top: 0.125rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.model-card-desc {
  font-size: 0.7rem;
  color: #6b7280;
  margin-top: 0.5rem;
  line-height: 1.4;
}
</style>
