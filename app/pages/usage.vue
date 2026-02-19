<script setup lang="ts">
// Placeholder for usage page
</script>

<template>
  <div class="min-h-screen bg-[#FFF9F0] py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-3xl mx-auto">
      <div class="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-[#FFE8D6]">
        <h1 class="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <span class="text-4xl">📚</span>
          使い方ガイド
        </h1>

        <div class="prose prose-orange max-w-none">
          <p class="text-lg text-gray-600 mb-8">
            Unicorn Laxを使って、大量の写真整理を効率化しましょう。
          </p>

          <div class="space-y-8">
            <section class="bg-orange-50 rounded-xl p-6 border border-orange-100">
              <h2 class="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                <div
                  class="w-8 h-8 rounded-full bg-orange-200 text-orange-700 flex items-center justify-center text-sm font-bold"
                >
                  1
                </div>
                写真をアップロード
              </h2>
              <p class="text-gray-600 ml-10">
                「写真を選択」ボタンから、整理したい写真をまとめてアップロードします。<br />
                処理はすべてお使いのブラウザ内で行われるため、写真が外部サーバーに送信されることはありません。安心してお使いください。
              </p>
            </section>

            <section class="bg-orange-50 rounded-xl p-6 border border-orange-100">
              <h2 class="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                <div
                  class="w-8 h-8 rounded-full bg-orange-200 text-orange-700 flex items-center justify-center text-sm font-bold"
                >
                  2
                </div>
                AIによる自動分類を確認
              </h2>
              <p class="text-gray-600 ml-10">
                AIが自動で顔を認識し、人物ごとにグループ分けします。<br />
                間違って分類されている写真があれば、正しいグループにドラッグ＆ドロップで移動できます。
              </p>
            </section>

            <section class="bg-orange-50 rounded-xl p-6 border border-orange-100">
              <h2 class="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                <div
                  class="w-8 h-8 rounded-full bg-orange-200 text-orange-700 flex items-center justify-center text-sm font-bold"
                >
                  3
                </div>
                アルバムの作成
              </h2>
              <p class="text-gray-600 ml-10">
                「みんなバランスよく」選ぶか、「ひとりの成長記録」を作るか選べます。<br />
                欲しい枚数を指定すれば、AIが良い表情の写真を自動でセレクトします。
              </p>
            </section>
          </div>

          <div class="mt-10 flex justify-center">
            <NuxtLink
              to="/"
              class="inline-flex items-center gap-2 px-6 py-3 bg-[#FF6B6B] text-white rounded-full hover:bg-[#e55a5a] font-bold shadow-lg shadow-orange-200 transition-all transform hover:-translate-y-0.5"
            >
              ← トップに戻ってはじめる
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
