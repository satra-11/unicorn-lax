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
  },
})
