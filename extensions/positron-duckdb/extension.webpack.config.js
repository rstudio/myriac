/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const { IgnorePlugin } = require('webpack');
const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.ts',
	},
	node: {
		__dirname: false
	},
	// Wasm support
	resolve: {
		extensions: ['.ts', '.js', '.wasm'],  // Ensure WebAssembly files are recognized
	},
	output: {
		webassemblyModuleFilename: 'dist/[hash].wasm'
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							compilerOptions: {
								'sourceMap': true,
							},
							onlyCompileBundledFiles: true,
						},
					}
				]
			},
			{
				test: /.*\.wasm$/,
				type: 'asset/resource',
				generator: {
					filename: 'dist/[name].[contenthash][ext]',
				},
			}
		],
	},
	experiments: {
		asyncWebAssembly: true,  // Enable WebAssembly support in Webpack
	},
	plugins: [
		...withDefaults.nodePlugins(__dirname),
		new IgnorePlugin({
			resourceRegExp: /.*duckdb-node\.ts$/
		})
	]
});
