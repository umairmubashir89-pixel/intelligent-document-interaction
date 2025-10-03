// Tailwind v4: use the new PostCSS plugin package
function safeRequire(name) {
  try { return require(name); } catch { return null; }
}

// Prefer the v4 plugin if present; fall back to nothing (Vite keeps running)
const tailwindPlugin = safeRequire("@tailwindcss/postcss");
const autoprefixer = safeRequire("autoprefixer");

module.exports = {
  plugins: [
    tailwindPlugin && tailwindPlugin(),
    autoprefixer && autoprefixer(),
  ].filter(Boolean),
};
