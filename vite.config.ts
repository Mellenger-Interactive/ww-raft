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
        main: 'index.html',
        tubePicker: 'tube-picker.html',
      },
    },
  },
}))
