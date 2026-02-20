<script setup lang="ts">
defineProps<{
  modelValue: 'group' | 'growth'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: 'group' | 'growth'): void
}>()

const selectMode = (mode: 'group' | 'growth') => {
  emit('update:modelValue', mode)
}
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Group Mode Card -->
    <div
      class="cursor-pointer relative rounded-xl border-2 p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
      :class="[
        modelValue === 'group'
          ? 'border-[#FF6B6B] bg-[#FFF5F0]'
          : 'border-gray-200 bg-white hover:border-[#FFD4C4]',
      ]"
      @click="selectMode('group')"
    >
      <div class="flex items-start gap-4 h-full">
        <div
          class="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-colors"
          :class="[
            modelValue === 'group' ? 'bg-[#FF6B6B] text-white' : 'bg-gray-100 text-gray-400',
          ]"
        >
          <span class="i-lucide-users w-6 h-6" />
        </div>
        <div class="flex-1">
          <h3
            class="font-bold text-lg mb-1"
            :class="[modelValue === 'group' ? 'text-[#FF6B6B]' : 'text-gray-700']"
          >
            みんなバランスよく
          </h3>
          <p class="text-sm text-gray-600 leading-relaxed">
            複数の子を均等に選びます。<br />
            クラスのアルバムなどに最適です。
          </p>
        </div>
      </div>
      <!-- Checkmark for selected state -->
      <div v-if="modelValue === 'group'" class="absolute top-3 right-3 text-[#FF6B6B]">
        <span class="i-lucide-check-circle-2 w-5 h-5" />
      </div>
    </div>

    <!-- Growth Mode Card -->
    <div
      class="cursor-pointer relative rounded-xl border-2 p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
      :class="[
        modelValue === 'growth'
          ? 'border-[#FF6B6B] bg-[#FFF5F0]'
          : 'border-gray-200 bg-white hover:border-[#FFD4C4]',
      ]"
      @click="selectMode('growth')"
    >
      <div class="flex items-start gap-4 h-full">
        <div
          class="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-colors"
          :class="[
            modelValue === 'growth' ? 'bg-[#FF6B6B] text-white' : 'bg-gray-100 text-gray-400',
          ]"
        >
          <span class="i-lucide-sprout w-6 h-6" />
        </div>
        <div class="flex-1">
          <h3
            class="font-bold text-lg mb-1"
            :class="[modelValue === 'growth' ? 'text-[#FF6B6B]' : 'text-gray-700']"
          >
            ひとりの成長記録
          </h3>
          <p class="text-sm text-gray-600 leading-relaxed">
            1人の写真を時間順に選びます。<br />
            個人の成長記録に最適です。
          </p>
        </div>
      </div>
      <!-- Checkmark for selected state -->
      <div v-if="modelValue === 'growth'" class="absolute top-3 right-3 text-[#FF6B6B]">
        <span class="i-lucide-check-circle-2 w-5 h-5" />
      </div>
    </div>
  </div>
</template>
