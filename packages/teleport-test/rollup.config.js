import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json'
import { terser } from 'rollup-plugin-terser';

export default {
	input: 'src/client.mjs',
	output: {
		file: 'dist-rollup/bundle.js',
		format: 'iife',
		sourcemap: true,
		inlineDynamicImports: true
	},
	plugins: [
		resolve(),
		commonjs(),
		json(),
		terser()
	]
};
