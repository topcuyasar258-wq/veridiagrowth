import js from "@eslint/js"
import nextPlugin from "@next/eslint-plugin-next"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "**/.next/**",
      "coverage/**",
      "dist/**",
      // Built tracker bundles, republished here by tracker:build. Linting a
      // minified artifact reports on generated code, and because the rules are
      // type-aware it fails outright on a file no tsconfig covers.
      "apps/dashboard/public/t/**",
      "apps/dashboard/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/supabase/admin", "**/supabase/admin.*"],
              message:
                "Service-role Supabase client is server-only and must not be imported from client modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/dashboard/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    files: ["apps/dashboard/src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
)
