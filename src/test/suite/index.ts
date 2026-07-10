import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import Mocha from 'mocha';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.PI_TEST = "1";

// Inside the VS Code extension host, console output is routed to the Output
// channel rather than stdout, so the default reporter's results are swallowed.
// Mirror results to a file we can read back after the run.
const reportPath = path.resolve(__dirname, 'test-results.log');

export async function run(): Promise<void> {
	// Inside the VS Code extension host, console output is routed to the
	// Output channel rather than stdout, so the default reporter's results
	// are swallowed. Results are mirrored to reportPath (module scope).

	const mocha = new Mocha({
		ui: 'tdd',
		color: false,
		timeout: 10000,
		reporter: 'spec',
	});

	const testsRoot = path.resolve(__dirname, '.');
	const files = await glob('**/**.test.js', { cwd: testsRoot });

	for (const file of files) {
		mocha.addFile(path.resolve(testsRoot, file));
	}

	return new Promise((resolve, reject) => {
		try {
			const runner = mocha.run((failures) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});

			// Inside the VS Code extension host, console output is routed to the
			// Output channel rather than stdout, so the reporter's results are
			// swallowed. Mirror pass/fail results to a file we can read back.
			const results = { pass: 0, fail: 0, failures: [] as string[] };
			runner.on('pass', () => {
				results.pass++;
			});
			runner.on('fail', (test: any, err: any) => {
				results.fail++;
				results.failures.push(
					`${test.fullTitle()}: ${err && err.message ? err.message : String(err)}`,
				);
			});
			runner.on('end', () => {
				const lines = [`PASS: ${results.pass}  FAIL: ${results.fail}`];
				for (const f of results.failures) {
					lines.push(`FAIL: ${f}`);
				}
				fs.writeFileSync(reportPath, lines.join('\n') + '\n');
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}
