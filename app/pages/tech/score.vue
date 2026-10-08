<template>
  <div>
    <h1 class="text-3xl font-bold text-gray-900 mb-6 border-b border-orange-100 pb-4">
      写真選定のスコア計算について
    </h1>
    <div class="prose prose-orange max-w-none">
      <p class="text-gray-600 mb-8">
        Photo Laxでは、複数の要素を組み合わせて写真の「良さ（スコア）」を計算し、アルバムや成長記録に最適な写真を自動選定しています。
      </p>

      <section class="mb-10">
        <h2 class="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <UIcon name="i-lucide-check-circle-2" class="w-6 h-6 text-orange-500" />
          主な評価基準
        </h2>
        <ul class="space-y-4 text-gray-600 list-none pl-0">
          <li class="bg-orange-50 p-4 rounded-lg border border-orange-100">
            <strong class="text-gray-900 flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-smile" class="w-5 h-5" /> 笑顔スコア (Smile Score)
            </strong>
            検出された顔の笑顔度合いを評価します。笑顔が多いほどスコアが高くなります。
          </li>
          <li class="bg-orange-50 p-4 rounded-lg border border-orange-100">
            <strong class="text-gray-900 flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-user" class="w-5 h-5" /> 顔の向き (Orientation)
            </strong>
            顔が正面を向いているかを評価します。横顔（Panスコアが高い）より正面を向いている方が高得点になります。
          </li>
          <li class="bg-orange-50 p-4 rounded-lg border border-orange-100">
            <strong class="text-gray-900 flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-award" class="w-5 h-5" /> 顔の品質 (Face Score)
            </strong>
            AIモデルが判定する顔の検出信頼度や画像の品質を加味します。
          </li>
          <li class="bg-orange-50 p-4 rounded-lg border border-orange-100">
            <strong class="text-gray-900 flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-camera" class="w-5 h-5" /> ブレ (Blur)
            </strong>
            写真全体のブレやボケの度合いを評価し、鮮明な写真を優先します。
          </li>
        </ul>
      </section>

      <section class="mb-10">
        <h2 class="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <UIcon name="i-lucide-scale" class="w-6 h-6 text-orange-500" />
          バランス・多様性の調整
        </h2>
        <ul class="space-y-4 text-gray-600 list-none pl-0">
          <li class="bg-white p-4 rounded-lg border border-gray-200">
            <strong class="text-gray-900 block mb-1">グループバランス (Group Balance)</strong>
            被写体が偏らないように、標準偏差を用いたペナルティ（分散ペナルティ）を導入しています。特定の人物ばかりが選ばれるのを防ぎます。<br />
            また、「ソロ写真」と「グループ写真」のどちらを優先するかのバイアス調整も行われます。
          </li>
          <li class="bg-white p-4 rounded-lg border border-gray-200">
            <strong class="text-gray-900 block mb-1">シーンの多様性 (Scene Diversity)</strong>
            同じような背景・シーンばかりにならないよう、シーンの多様性を評価に組み込み、同じカテゴリが連続して選ばれるとペナルティを与えます。
          </li>
        </ul>
      </section>

      <section>
        <h2 class="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <UIcon name="i-lucide-functions" class="w-6 h-6 text-orange-500" />
          スコアの算出式（概要）
        </h2>
        <div class="bg-gray-800 text-orange-50 p-5 rounded-xl font-mono text-sm overflow-x-auto shadow-inner">
          <p class="whitespace-nowrap mb-2">
            <span class="text-orange-400">Score</span> = (<span class="text-blue-300">検出された顔の数</span>) + (<span class="text-green-300">品質スコア</span>)
          </p>
          <p class="whitespace-nowrap">
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- (<span class="text-purple-300">K × 分散ペナルティ</span>) - (<span class="text-red-300">多様性ペナルティ</span>)
          </p>
        </div>
        <p class="mt-4 text-sm text-gray-500">
          ※ 実際のアルゴリズムでは、ユーザーが指定した重み（weights）により各要素の影響度が動的に変化します。
        </p>
      </section>
    </div>
  </div>
</template>
