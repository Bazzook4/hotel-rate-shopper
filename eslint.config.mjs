import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // Characters that make text read as machine-written. Write plain ASCII:
    // "Setup > Rooms", "12 Oct to 14 Oct", "-" for an empty cell, "...",
    // straight quotes, commas between facts, and <Icon> for symbols.
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          ["Literal", "value"],
          ["TemplateElement", "value.raw"],
          ["JSXText", "value"],
        ].map(([node, field]) => ({
          selector: `${node}[${field}=/[→←↑↓⇒—–…·•“”‘’×✓✔✕★☆≈]|\\p{Extended_Pictographic}/u]`,
          message: "Plain text only: no arrows, dashes, ellipsis, dots, curly quotes, symbols or emoji. Use words, ASCII punctuation or <Icon>.",
        })),
      ],
    },
  },
  {
    // The scraper reads Google's own text, which uses these characters.
    files: ["src/lib/scraper/**"],
    rules: { "no-restricted-syntax": "off" },
  },
];

export default eslintConfig;
