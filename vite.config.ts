import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5176 },
  plugins: [sveltekit(), devtoolsJson()]
});
