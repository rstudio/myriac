/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console ANSI styling', { tag: ['@pr', '@console'] }, () => {
	test.beforeEach(async function ({ app }) {
		await app.workbench.positronLayouts.enterLayout('fullSizedPanel');
	});

	test("R - Can produce clickable file links [C683069]", async function ({ app, r }) {
		// Can be any file on the workkspace. We use .gitignore as it's probably
		// always there.
		const fileName = '.gitignore';
		const filePath = join(app.workspacePathOrFolder, fileName);
		const inputCode = `cli::cli_inform(r"[{.file ${filePath}}]")`;

		await expect(async () => {
			await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
			await app.workbench.positronConsole.sendEnterKey();

			// Locate the link and click on it
			const link = app.workbench.positronConsole.getLastClickableLink();
			await expect(link).toContainText(fileName, { useInnerText: true });

			await link.click();
			await app.workbench.editors.waitForActiveTab(fileName);
		}).toPass({ timeout: 60000 });
	});

	test("R - Can produce clickable help links [C683070]", async function ({ app, r }) {
		const inputCode = `cli::cli_inform("{.fun base::mean}")`;

		await expect(async () => {
			await app.workbench.positronConsole.pasteCodeToConsole(inputCode);
			await app.workbench.positronConsole.sendEnterKey();

			// Locate the link and click on it
			const link = app.workbench.positronConsole.getLastClickableLink();
			await expect(link).toContainText('base::mean', { useInnerText: true });

			await link.click();
			await app.code.wait(200);

			const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
			await expect(helpFrame.locator('body')).toContainText('Arithmetic Mean');
		}).toPass({ timeout: 60000 });
	});

	test("R - Can produce colored output [C683071]", async function ({ app, r }) {
		const color = '#ff3333';
		const rgb_color = "rgb(255, 51, 51)"; // same as above but in rgb

		await expect(async () => {
			await app.workbench.positronConsole.pasteCodeToConsole(
				`
						cli::cli_div(theme = list(span.emph = list(color = "${color}")))
						cli::cli_text("This is very {.emph important}")
						cli::cli_end()
						`
			);
		}).toPass();

		await app.workbench.positronConsole.sendEnterKey();

		const styled_locator = app.workbench.positronConsole.activeConsole.getByText("important").last();
		await expect(styled_locator).toHaveCSS('font-style', 'italic');
		await expect(styled_locator).toHaveCSS('color', rgb_color);
	});
});
