// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Your custom configs here
  {
    ignores: ['public/**/*', 'dist/**/*'],
  },
).append({
  // Prettier integration
  // manually adding prettier config since withNuxt returns a composer
  plugins: {
    prettier: (await import('eslint-plugin-prettier')).default,
  },
  rules: {
    'prettier/prettier': 'error',
    // turn off conflicting rules
    ...(await import('eslint-config-prettier')).default.rules,
    // Practical overrides
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    '@typescript-eslint/no-extraneous-class': 'off',
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
  },
})
