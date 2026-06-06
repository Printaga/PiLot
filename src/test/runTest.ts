import * as path from 'path';
import { fileURLToPath } from 'url';
import { runTests } from '@vscode/test-electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
	try {
		// The extension development path is the project root
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		// The test runner file loaded by the VS Code extension host
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-extensions'],
		});
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

main();
