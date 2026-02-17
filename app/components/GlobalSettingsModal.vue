<script setup lang="ts">
import { usePhotoProcessor } from '~/composables/usePhotoProcessor'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { faceModel, setFaceModel } = usePhotoProcessor()

const selectModel = (model: 'ssd' | 'tiny') => {
  setFaceModel(model)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="$emit('close')"></div>

      <!-- Modal Content -->
      <div
        class="relative bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden z-10 flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex justify-between items-center p-6 border-b bg-gray-50">
          <h2 class="text-xl font-bold text-gray-900">設定 (Settings)</h2>
          <button
            @click="$emit('close')"
            class="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-200 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-6">
          <!-- Model Selection -->
          <div>
            <h3 class="text-sm font-semibold text-gray-900 mb-2">
              顔検出モデル (Face Detection Model)
            </h3>
            <p class="text-xs text-gray-500 mb-4">
              顔検出に使用するAIモデルを選択します。変更は次回の検出から適用されます。
            </p>

            <div class="grid grid-cols-1 gap-4">
              <!-- SSD MobileNet V1 -->
              <div
                @click="selectModel('ssd')"
                class="relative border rounded-lg p-4 cursor-pointer transition-all hover:bg-gray-50 flex items-start gap-3"
                :class="
                  faceModel === 'ssd'
                    ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/50'
                    : 'border-gray-200'
                "
              >
                <div class="mt-0.5">
                  <div
                    class="w-4 h-4 rounded-full border border-gray-400 flex items-center justify-center"
                    :class="{ 'border-blue-600': faceModel === 'ssd' }"
                  >
                    <div
                      v-if="faceModel === 'ssd'"
                      class="w-2.5 h-2.5 rounded-full bg-blue-600"
                    ></div>
                  </div>
                </div>
                <div>
                  <div class="font-medium text-gray-900">高精度 (SSD MobileNet V1)</div>
                  <div class="text-xs text-gray-500 mt-1">
                    精度が高く、小さな顔や横顔も検出しやすい標準的なモデルです。<br />
                    <span class="text-blue-600 font-semibold">推奨 (Recommended)</span>
                  </div>
                </div>
              </div>

              <!-- Tiny Face Detector -->
              <div
                @click="selectModel('tiny')"
                class="relative border rounded-lg p-4 cursor-pointer transition-all hover:bg-gray-50 flex items-start gap-3"
                :class="
                  faceModel === 'tiny'
                    ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/50'
                    : 'border-gray-200'
                "
              >
                <div class="mt-0.5">
                  <div
                    class="w-4 h-4 rounded-full border border-gray-400 flex items-center justify-center"
                    :class="{ 'border-blue-600': faceModel === 'tiny' }"
                  >
                    <div
                      v-if="faceModel === 'tiny'"
                      class="w-2.5 h-2.5 rounded-full bg-blue-600"
                    ></div>
                  </div>
                </div>
                <div>
                  <div class="font-medium text-gray-900">高速 (Tiny Face Detector)</div>
                  <div class="text-xs text-gray-500 mt-1">
                    処理が非常に高速ですが、精度はやや劣ります。大量の画像を素早く処理したい場合に適しています。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="p-6 border-t bg-gray-50 flex justify-end">
          <button
            @click="$emit('close')"
            class="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-black transition-colors shadow-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
