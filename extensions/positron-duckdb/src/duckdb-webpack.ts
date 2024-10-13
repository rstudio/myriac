/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm';

export function getDuckDBWebpackBundles() {
	return {
		mvp: {
			mainModule: duckdb_wasm,
			// @ts-ignore: Suppress TypeScript warning for import.meta.url
			mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js', import.meta.url).toString(),
		},
		eh: {
			mainModule: duckdb_wasm_eh,
			// @ts-ignore: Suppress TypeScript warning for import.meta.url
			mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url).toString(),
		}
	};
}
