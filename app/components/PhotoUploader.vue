<script setup lang="ts">
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'

const props = defineProps<{
  currentSessionId?: string
}>()

const { processFiles, isProcessing, progress, total, currentSession, faceModel, setFaceModel } =
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
      <h2 class="text-xl font-bold mb-4 text-black">写真のアップロード</h2>

      <!-- Model Selection -->
      <div class="mb-6 max-w-sm mx-auto text-left">
        <label class="block text-sm font-medium text-gray-700 mb-2">顔検出モデル</label>
        <div class="grid grid-cols-1 gap-2">
          <label
            class="flex items-center p-3 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
            :class="faceModel === 'ssd' ? 'border-blue-500 bg-blue-50/30' : 'border-gray-200'"
          >
            <input
              type="radio"
              name="faceModel"
              value="ssd"
              :checked="faceModel === 'ssd'"
              class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              @change="setFaceModel('ssd')"
            />
            <div class="ml-3">
              <div class="text-sm font-medium text-gray-900">高精度 (SSD MobileNet V1)</div>
              <div class="text-xs text-gray-500">標準的な精度。推奨。</div>
            </div>
          </label>

          <label
            class="flex items-center p-3 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
            :class="faceModel === 'tiny' ? 'border-blue-500 bg-blue-50/30' : 'border-gray-200'"
          >
            <input
              type="radio"
              name="faceModel"
              value="tiny"
              :checked="faceModel === 'tiny'"
              class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
              @change="setFaceModel('tiny')"
            />
            <div class="ml-3">
              <div class="text-sm font-medium text-gray-900">高速 (Tiny Face Detector)</div>
              <div class="text-xs text-gray-500">精度は劣るが高速。</div>
            </div>
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
    </div>
  </div>
</template>
