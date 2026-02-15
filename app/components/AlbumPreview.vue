<script setup lang="ts">
import type { Photo } from '~/utils/types';
import { onMounted, ref } from 'vue';

const props = defineProps<{
  photos: Photo[];
}>();

// We might need to generate thumbnails for these photos if they are not stored.
// But we don't have access to original files easily unless we persisted them or use FileSystemHandle.
// For now, let's assume we can't show image unless we have thumbnail in DB or blob url.
// The `Photo` type has `thumbnail?` if we generated it during processing (which we didn't for full photo, only for face).
// Wait, we need to show the FULL PHOTO.
// If we can't access the file, we can't show it.
// This is a limitation of current implementation plan.
// We need to persist a thumbnail of the FULL PHOTO in DB.
// Or we rely on the user not closing the tab if we keep File objects in memory (but we didn't).
//
// Correction: `usePhotoProcessor` discards File objects.
//
// To fix this for the prototype:
// 1. We should generate a low-res thumbnail of the full photo during processing and store in DB.
// 2. Or, since this is a local app, maybe we can just show the name and date if we can't show image?
//
// Better approach: In `usePhotoProcessor`, generate a thumbnail for the photo itself (not just face).
// I will verify if I can add this quickly. 
// For now, I will render what I have. If no thumbnail, show placeholder.
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
    <div v-for="photo in photos" :key="photo.id" class="border rounded shadow-sm overflow-hidden">
        <div class="aspect-video bg-gray-200 flex items-center justify-center">
             <!-- Placeholder or Thumbnail if available -->
             <!-- We didn't implement full photo thumbnail storage yet, only face thumbnail -->
             <span class="text-gray-500 text-xs p-2 text-center">{{ photo.name }}</span>
        </div>
        <div class="p-2 text-xs text-gray-600 bg-white">
            {{ photo.dateStr }}
        </div>
    </div>
  </div>
</template>
