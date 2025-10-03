module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  rules: { "no-unused-vars": "warn" }
};
