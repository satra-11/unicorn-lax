<script setup lang="ts">
useHead({
  title: 'Unicorn Lax — AI写真選定ツール',
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    {
      name: 'description',
      content:
        'AIが顔認識で写真を自動分類・選定。保育園・幼稚園のアルバム作成を90%効率化するブラウザ完結型ツール。',
    },
    { property: 'og:title', content: 'Unicorn Lax — AI写真選定ツール' },
    {
      property: 'og:description',
      content:
        'AIが顔認識で写真を自動分類・選定。保育園・幼稚園のアルバム作成を90%効率化するブラウザ完結型ツール。',
    },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary' },
  ],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: {
    lang: 'ja',
  },
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
