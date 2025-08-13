import devtoolsJsonModule from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Resolve default export interop between ESM/CJS
const devtoolsJson = (devtoolsJsonModule as any).default ?? (devtoolsJsonModule as any);

export default defineConfig({
  server: { port: 5176 },
  plugins: [sveltekit(), devtoolsJson()]
});
