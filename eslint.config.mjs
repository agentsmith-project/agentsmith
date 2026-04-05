import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/rules-of-hooks": "warn",
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Test and mock code favors velocity; keep strictness on production paths.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**", "**/mocks/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "artifacts/**",
      "test-results/**",
      "playwright-report/**",
      "e2e/**",
      "scripts/**",
      "public/mockServiceWorker.js",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
