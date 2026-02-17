<script setup lang="ts">
interface StepDef {
  label: string
  description: string
}

defineProps<{
  currentStep: 1 | 2 | 3
  completedStep: 0 | 1 | 2 | 3
  steps: StepDef[]
}>()
</script>

<template>
  <div class="step-indicator">
    <div
      v-for="(stepDef, index) in steps"
      :key="index"
      class="step-item"
    >
      <!-- Connector line (before) -->
      <div
        v-if="index > 0"
        class="step-connector"
        :class="{ 'step-connector-completed': completedStep >= index }"
      />

      <!-- Circle -->
      <div
        class="step-circle"
        :class="{
          'step-circle-completed': completedStep > index,
          'step-circle-active': completedStep <= index && currentStep === index + 1,
          'step-circle-pending': completedStep <= index && currentStep !== index + 1,
        }"
      >
        <svg
          v-if="completedStep > index"
          xmlns="http://www.w3.org/2000/svg"
          class="step-check-icon"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
        <span v-else class="step-number">{{ index + 1 }}</span>
      </div>

      <!-- Labels -->
      <div class="step-labels">
        <span
          class="step-label"
          :class="{
            'step-label-active': currentStep === index + 1 || completedStep > index,
          }"
        >
          {{ stepDef.label }}
        </span>
        <span class="step-description">{{ stepDef.description }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-indicator {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 0;
  padding: 1.5rem 1rem;
  margin-bottom: 1.5rem;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  flex: 1;
  max-width: 200px;
}

.step-connector {
  position: absolute;
  top: 18px;
  right: 50%;
  width: 100%;
  height: 2px;
  background: #e5e7eb;
  z-index: 0;
  transition: background 0.3s ease;
}

.step-connector-completed {
  background: linear-gradient(90deg, #3b82f6, #6366f1);
}

.step-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 700;
  transition: all 0.3s ease;
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.step-circle-completed {
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  color: white;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.step-circle-active {
  background: white;
  color: #3b82f6;
  border: 2.5px solid #3b82f6;
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
}

.step-circle-pending {
  background: #f3f4f6;
  color: #9ca3af;
  border: 2px solid #e5e7eb;
}

.step-check-icon {
  width: 18px;
  height: 18px;
}

.step-number {
  line-height: 1;
}

.step-labels {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 0.5rem;
  text-align: center;
}

.step-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #9ca3af;
  transition: color 0.3s ease;
}

.step-label-active {
  color: #1f2937;
}

.step-description {
  font-size: 0.7rem;
  color: #9ca3af;
  margin-top: 0.125rem;
  white-space: nowrap;
}
</style>
