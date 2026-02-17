<script setup lang="ts">
import type { Photo } from '~/utils/types'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  photos: Photo[]
}>()

const emit = defineEmits<{
  (e: 'update:photos', photos: Photo[]): void
}>()

// Track blob URLs for cleanup
const blobUrls = ref(new Map<string, string>())

const getThumbnailUrl = (photo: Photo): string => {
  if (!photo.thumbnail) return ''
  const existing = blobUrls.value.get(photo.id)
  if (existing) return existing
  const url = URL.createObjectURL(photo.thumbnail)
  blobUrls.value.set(photo.id, url)
  return url
}

// Revoke old blob URLs when photos change
watch(
  () => props.photos,
  (_newPhotos, oldPhotos) => {
    if (!oldPhotos) return
    const newIds = new Set(_newPhotos.map((p) => p.id))
    for (const [id, url] of blobUrls.value) {
      if (!newIds.has(id)) {
        URL.revokeObjectURL(url)
        blobUrls.value.delete(id)
      }
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  for (const url of blobUrls.value.values()) {
    URL.revokeObjectURL(url)
  }
})

const togglePhoto = (photo: Photo) => {
  const updated = props.photos.map((p) => (p.id === photo.id ? { ...p, excluded: !p.excluded } : p))
  emit('update:photos', updated)
}

const includedCount = computed(() => props.photos.filter((p) => !p.excluded).length)

const matchedPhotos = computed(() => props.photos.filter((p) => !p.noFaceMatch))

const unmatchedPhotos = computed(() => props.photos.filter((p) => p.noFaceMatch))
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <p class="text-sm text-gray-500">{{ includedCount }} / {{ photos.length }} 枚 選択中</p>
    </div>

    <!-- Matched photos -->
    <div v-if="matchedPhotos.length > 0" class="mb-6">
      <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <span
          class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-600 text-xs"
          >✓</span
        >
        顔認識あり ({{ matchedPhotos.length }})
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <div
          v-for="photo in matchedPhotos"
          :key="photo.id"
          class="relative border-2 rounded-lg overflow-hidden cursor-pointer transition-all"
          :class="
            photo.excluded
              ? 'border-gray-200 opacity-40 grayscale'
              : 'border-green-300 ring-1 ring-green-200'
          "
          @click="togglePhoto(photo)"
        >
          <div class="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
            <img
              v-if="getThumbnailUrl(photo)"
              :src="getThumbnailUrl(photo)"
              :alt="photo.name"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-gray-400 text-xs p-2 text-center truncate">{{
              photo.name
            }}</span>
          </div>
          <div class="p-2 text-xs text-gray-600 bg-white flex items-center justify-between gap-1">
            <span class="truncate">{{ photo.dateStr }}</span>
            <span
              v-if="!photo.excluded"
              class="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white text-[10px]"
              >✓</span
            >
            <span
              v-else
              class="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-300 text-white text-[10px]"
              >✕</span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Unmatched photos -->
    <div v-if="unmatchedPhotos.length > 0">
      <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <span
          class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-xs"
          >⚠</span
        >
        顔未検出 ({{ unmatchedPhotos.length }})
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <div
          v-for="photo in unmatchedPhotos"
          :key="photo.id"
          class="relative border-2 rounded-lg overflow-hidden cursor-pointer transition-all"
          :class="
            photo.excluded
              ? 'border-gray-200 opacity-40 grayscale'
              : 'border-amber-300 ring-1 ring-amber-200'
          "
          @click="togglePhoto(photo)"
        >
          <div class="aspect-video bg-amber-50 flex items-center justify-center overflow-hidden">
            <img
              v-if="getThumbnailUrl(photo)"
              :src="getThumbnailUrl(photo)"
              :alt="photo.name"
              class="w-full h-full object-cover"
            />
            <span v-else class="text-gray-400 text-xs p-2 text-center truncate">{{
              photo.name
            }}</span>
          </div>
          <div class="p-2 text-xs text-gray-600 bg-white flex items-center justify-between gap-1">
            <span class="truncate">{{ photo.dateStr }}</span>
            <span
              v-if="!photo.excluded"
              class="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px]"
              >✓</span
            >
            <span
              v-else
              class="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-300 text-white text-[10px]"
              >✕</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
