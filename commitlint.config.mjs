/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Los mensajes van en español; no forzamos mayúsculas/minúsculas del asunto.
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "docs",
        "test",
        "ci",
        "chore",
        "build",
        "security",
        "revert",
      ],
    ],
  },
};
