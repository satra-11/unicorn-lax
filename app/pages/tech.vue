<script setup lang="ts">
const navLinks = [
  { label: 'スコア計算について', to: '/tech/score', icon: 'i-lucide-calculator' },
  { label: 'モデル選定', to: '/tech/model', icon: 'i-lucide-brain' },
]
</script>

<template>
  <div class="min-h-screen bg-[#FFF9F0] py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-6xl mx-auto flex flex-col md:flex-row gap-8">
      <!-- Sidebar Navigation -->
      <aside class="w-full md:w-64 flex-shrink-0">
        <div class="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-[#FFE8D6] sticky top-24">
          <h2 class="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span class="text-2xl">🔧</span>
            技術情報
          </h2>
          <nav class="space-y-2">
            <NuxtLink
              v-for="link in navLinks"
              :key="link.to"
              :to="link.to"
              class="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
              active-class="bg-orange-100 text-orange-900"
              inactive-class="text-gray-600 hover:bg-orange-50 hover:text-gray-900"
            >
              <UIcon :name="link.icon" class="w-4 h-4" />
              {{ link.label }}
            </NuxtLink>
          </nav>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="flex-1 overflow-hidden">
        <div class="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-[#FFE8D6]">
          <NuxtPage />
        </div>
      </main>
    </div>
  </div>
</template>
