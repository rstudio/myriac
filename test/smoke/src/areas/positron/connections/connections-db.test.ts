/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('SQLite DB Connection', { tag: ['@web', '@win'] }, () => {
	test.afterEach(async function ({ app }) {
		app.workbench.positronConnections.removeConnectionButton.click();
	});

	test('Python - SQLite DB Connection [C628636]', async function ({ app, logger, python }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		await expect(async () => {
			logger.log('Opening connections pane');
			await app.workbench.positronVariables.doubleClickVariableRow('conn');
			// in Python this will open all table connections, so should be fine.
			await app.workbench.positronConnections.openTree();

			// click in reverse order to avoid scrolling issues
			await app.workbench.positronConnections.hasConnectionNodes(['albums']);
		}).toPass({ timeout: 60000 });

		// disconnect icon appearance requires hover
		await app.workbench.positronConnections.pythonConnectionOpenState.hover();
		await app.workbench.positronConnections.disconnectButton.click();
		await app.workbench.positronConnections.reconnectButton.waitforVisible();
	});


	test('R - SQLite DB Connection [C628637]', async function ({ app, logger, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
		await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

		await expect(async () => {
			logger.log('Opening connections pane');
			await app.workbench.positronConnections.openConnectionPane();
			await app.workbench.positronConnections.openTree();

			// click in reverse order to avoid scrolling issues
			// in R, the opneTree command only shows all tables, we click to also
			// display fields
			await app.workbench.positronConnections.openConnectionsNodes(tables);
		}).toPass({ timeout: 60000 });

		// disconnect icon appearance requires hover
		await app.workbench.positronConnections.rConnectionOpenState.hover();
		await app.workbench.positronConnections.disconnectButton.click();
		await app.workbench.positronConnections.reconnectButton.waitforVisible();
	});

	test('R - Connections are update after adding a database,[C663724]', async function ({ app, logger, r }) {
		// open an empty connection
		await app.workbench.positronConsole.executeCode(
			'R',
			`con <- connections::connection_open(RSQLite::SQLite(), tempfile())`,
			'>'
		);

		// should be able to see the new connection in the connections pane
		logger.log('Opening connections pane');
		await app.workbench.positronConnections.connectionsTabLink.click();

		await app.workbench.positronConnections.openTree();

		const visible = await app.workbench.positronConnections.hasConnectionNode("mtcars");
		if (visible) {
			throw new Error("mtcars should not be visible");
		}

		await expect(async () => {
			// now we add a dataframe to that connection
			await app.workbench.positronConsole.executeCode(
				'R',
				`DBI::dbWriteTable(con, "mtcars", mtcars)`,
				'>'
			);
			// the panel should be automatically updated and we should be able to see
			// that table and click on it
			await app.workbench.positronConnections.openConnectionsNodes(["mtcars"]);
		}).toPass();
	});

});


const tables = ['tracks', 'playlist_track', 'playlists', 'media_types', 'invoice_items', 'invoices', 'genres', 'employees', 'customers', 'artists', 'albums'];