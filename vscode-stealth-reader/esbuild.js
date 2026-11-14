const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

esbuild
  .context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  })
  .then(async (ctx) => {
    if (watch) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  })
  .catch(() => process.exit(1));
