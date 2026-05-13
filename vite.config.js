import { defineConfig } from 'vite';

// GitHub Pages serves this project under /dsc106-project3/, while Vercel
// serves it at the root. Vercel sets process.env.VERCEL=1 during builds,
// so detect that and emit root-relative asset/data URLs there.
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

export default defineConfig({
  base: isVercel ? '/' : '/dsc106-project3/',
});
