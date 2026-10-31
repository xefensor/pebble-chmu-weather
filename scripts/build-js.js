'use strict';

// Always opt in explicitly to the personal app-service implementation.
const path = require('node:path');
const esbuild = require('esbuild');
const pkg = require('../package.json');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--variant' || !['public','personal'].includes(args[1]))) {
  throw Error('Usage: node scripts/build-js.js [--variant public|personal]');
}
const variant = args[1] || 'public';
esbuild.buildSync({
  absWorkingDir:path.resolve(__dirname,'..'), entryPoints:['src/plugin/index.js'],
  bundle:true, format:'iife', platform:'neutral', mainFields:['main','module'], target:'es2020',
  define:{__CHMU_PUBLIC_BUILD__:String(variant === 'public'), __CHMU_VERSION__:JSON.stringify(pkg.version)},
  banner:{js:'// CHMU_BUILD_VARIANT=' + variant},
  outfile:variant === 'personal' ? 'build/personal/plugin.js' : 'build/plugin.js'
});
