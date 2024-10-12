/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

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
	module: {
		rules: [
			{
				test: /\.wasm$/,  // Match .wasm files
				type: 'javascript/auto',  // Required for WebAssembly
				use: {
					loader: 'file-loader',
					options: {
						name: '[name].[hash].[ext]',  // Customize the output file name
						outputPath: 'wasm/',  // Output directory for WebAssembly files
					},
				},
			},
			{
				test: /\.worker\.cjs$/,  // Match worker files with .cjs extension
				use: {
					loader: 'file-loader',  // Load the worker files as separate chunks
					options: {
						name: '[name].[hash].[ext]',  // Customize the output worker file name
						outputPath: 'workers/',  // Output directory for worker files
					},
				},
			},
		],
	},
	experiments: {
		asyncWebAssembly: true,  // Enable WebAssembly support in Webpack
	},
});
