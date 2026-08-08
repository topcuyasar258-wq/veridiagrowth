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
