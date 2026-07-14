import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "**/playwright-report/**",
      "**/test-results/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node scripts and config files run in a Node environment.
  {
    files: [
      "scripts/**/*.mjs",
      "packages/*/scripts/**/*.mjs",
      "*.config.{js,ts}",
      "**/*.config.{js,ts}"
    ],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  },
  // The core package is the crown jewels: no `any` escapes.
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  prettier
);
