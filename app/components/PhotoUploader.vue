<script setup lang="ts">
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'

const props = defineProps<{
  currentSessionId?: string
}>()

const {
  processFiles,
  isProcessing,
  progress,
  total,
  currentSession,
  processingStatus,
} = usePhotoProcessor()

const onFolderSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    await processFiles(input.files, props.currentSessionId)
  }
}
</script>

<template>
  <div class="p-6 bg-[#FFFCFA] rounded-lg shadow-md border border-[#FFE8D6]">
    <div
      v-if="(!isProcessing && !currentSession?.status) || currentSession?.status === 'completed'"
      class="text-center"
    >


      <label
        class="cursor-pointer inline-flex items-center px-4 py-2 bg-[#FF6B6B] text-white rounded hover:bg-[#e55a5a]"
      >
        <span class="mr-2">写真フォルダをえらぶ</span>
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
      <h3 class="font-semibold text-lg mb-2 text-black">写真を読み込んでいます...</h3>
      <div class="w-full bg-gray-200 rounded-full h-4 mb-2">
        <div
          class="bg-[#FF6B6B] h-4 rounded-full transition-all duration-300"
          :style="{ width: `${(progress / total) * 100}%` }"
        ></div>
      </div>
      <p class="text-sm text-gray-600 text-center">{{ progress }} / {{ total }}</p>
      <p v-if="processingStatus" class="text-sm text-[#FF6B6B] text-center mt-2 animate-pulse">
        {{ processingStatus }}
      </p>
      <p v-else-if="progress === 0" class="text-sm text-gray-500 text-center mt-2">
        準備しています...
      </p>
    </div>
  </div>
</template>

