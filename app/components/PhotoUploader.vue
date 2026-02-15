<script setup lang="ts">
import { usePhotoProcessor } from '~/composables/usePhotoProcessor';

const { processFiles, isProcessing, progress, total, currentSession } = usePhotoProcessor();

const onFolderSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    await processFiles(input.files);
  }
};
</script>

<template>
  <div class="p-6 bg-white rounded-lg shadow-md">
    <div v-if="!isProcessing && !currentSession?.status || currentSession?.status === 'completed'" class="text-center">
      <h2 class="text-xl font-bold mb-4">Upload Photos</h2>
      <p class="mb-4 text-gray-600">Select a folder containing your photos (up to 10,000).</p>
      
      <label class="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
        <span class="mr-2">Select Folder</span>
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

    <div v-if="isProcessing || (currentSession && currentSession.status === 'processing')" class="mt-4">
      <h3 class="font-semibold text-lg mb-2">Processing...</h3>
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
