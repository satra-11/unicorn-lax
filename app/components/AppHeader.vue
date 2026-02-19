<script setup lang="ts">
const navLinks = [
  {
    label: '使い方',
    to: '/usage',
    icon: 'i-lucide-book-open',
    external: false,
  },
  {
    label: 'GitHub',
    to: 'https://github.com/satra-11/unicorn-lax',
    icon: 'i-simple-icons-github',
    external: true,
  },
]
</script>

<template>
  <header
    class="w-full bg-[#FFF9F0]/80 backdrop-blur-md border-b border-[#FFE8D6] sticky top-0 z-50"
  >
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16">
        <!-- Logo -->
        <div class="flex-shrink-0 flex items-center">
          <NuxtLink to="/" class="flex items-center gap-2 group">
            <span class="text-2xl pt-1 group-hover:scale-110 transition-transform duration-200"
              >🦄</span
            >
            <span
              class="font-bold text-xl tracking-tight text-gray-900 group-hover:text-[#FF6B6B] transition-colors"
            >
              Unicorn Lax
            </span>
          </NuxtLink>
        </div>

        <!-- Navigation -->
        <nav class="flex items-center gap-3">
          <template v-for="link in navLinks" :key="link.to">
            <NuxtLink
              :to="link.to"
              :target="link.external ? '_blank' : undefined"
              :rel="link.external ? 'noopener noreferrer' : undefined"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
              :class="[
                link.external
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                  : 'bg-orange-50 text-orange-700 hover:bg-orange-100 hover:text-orange-900',
              ]"
            >
              <UIcon :name="link.icon" class="w-4 h-4" />
              <span class="hidden sm:inline">{{ link.label }}</span>
            </NuxtLink>
          </template>
        </nav>
      </div>
    </div>
  </header>
</template>
