<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const handleError = () => clearError({ redirect: '/' })
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
    <div class="text-center max-w-md">
      <h1 class="text-6xl font-bold text-gray-300 mb-4">
        {{ error.statusCode || 500 }}
      </h1>
      <h2 class="text-xl font-semibold text-gray-800 mb-2">
        {{ error.statusCode === 404 ? 'ページが見つかりません' : 'エラーが発生しました' }}
      </h2>
      <p class="text-gray-500 mb-8">
        {{
          error.statusCode === 404
            ? 'お探しのページは存在しないか、移動された可能性があります。'
            : 'しばらく時間をおいてから再度お試しください。'
        }}
      </p>
      <button
        class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
        @click="handleError"
      >
        トップページに戻る
      </button>
    </div>
  </div>
</template>
