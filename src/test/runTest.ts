import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runTests } from '@vscode/test-electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVscodeExecutablePath(): string | undefined {
	const envPath = process.env.VSCODE_PATH;
	if (envPath && typeof envPath === 'string') {
		return envPath;
	}

	const platform = process.platform;

	if (platform === 'win32') {
		const winPaths = [
			'C:\\Program Files\\Microsoft VS Code\\Code.exe',
			'C:\\Program Files\\Visual Studio Code\\Code.exe',
			'C:\\Users\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
			path.join(process.env.LOCALAPPDATA || '', 'Programs\\Microsoft VS Code\\Code.exe'),
		];
		for (const exePath of winPaths) {
			if (existsSync(exePath)) {
				return exePath;
			}
		}
	} else if (platform === 'darwin') {
		const macPaths = [
			'/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
			'/Applications/VS Code.app/Contents/MacOS/Electron',
		];
		for (const exePath of macPaths) {
			if (existsSync(exePath)) {
				return exePath;
			}
		}
	} else {
		const linuxPaths = ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'];
		for (const exePath of linuxPaths) {
			if (existsSync(exePath)) {
				return exePath;
			}
		}
	}

	return undefined;
}

async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-extensions'],
			vscodeExecutablePath: getVscodeExecutablePath(),
		});
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

main();
