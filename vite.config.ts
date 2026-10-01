import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

export default defineConfig(({ command }) => ({
  // '/' for the dev server; '/ww-raft/' for the GitHub Pages build
  // (https://mellenger-interactive.github.io/ww-raft/).
  base: command === 'serve' ? '/' : '/ww-raft/',
  plugins: [glsl()],
  build: {
    rollupOptions: {
      input: {
        // The tube picker block is the home page; the original full-screen
        // demo (with the physics sliders) lives at demo.html.
        main: 'index.html',
        demo: 'demo.html',
      },
    },
  },
}))
