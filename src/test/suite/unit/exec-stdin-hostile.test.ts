// Real-process safety proofs for `execFileWithStdin` (no stubs, no model needed).
//
// `src/test/suite/unit/shell.test.ts` verifies this seam against a fake child
// process, which is the right level for timeout, error, and back-pressure
// behavior. This file covers the one property that a fake cannot honestly
// assert: that a hostile payload handed to the REAL implementation reaches the
// child process byte-for-byte and does not cause anything else to execute.
//
// The draft path feeds `git diff` output into a model, and that diff is
// attacker-influenced in the general case (a repository can contain a file whose
// name or contents look like shell syntax). So the guarantee here is not
// theoretical: if it ever regressed to a shell, `$(touch …)` in a staged file
// would run on the developer's machine.

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileWithStdin } from "../../../utils/shell.js";

/** Per-test scratch directory; real files land here so side effects are observable. */
function scratchDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pilot-stdin-proof-"));
}

suite("execFileWithStdin real-process payload safety", () => {
	test("a command-substitution payload reaches the child verbatim and executes nothing", async () => {
		const dir = scratchDir();
		const pwned = path.join(dir, "PWNED");
		const payload = [
			"diff --git a/x b/x",
			"+" + "$(touch " + pwned + ")",
			"+`touch " + path.join(dir, "BACKTICK") + "`",
			"+; touch " + path.join(dir, "SEMICOLON"),
			"+| touch " + path.join(dir, "PIPE"),
			"+&& touch " + path.join(dir, "AND"),
			"+NEWLINE_MARKER",
		].join("\n");

		// `cat` stands in for `pi`: it reads stdin and echoes it, so a correct
		// implementation round-trips the payload and a shell-interpreting one
		// would either differ in stdout or leave a marker file behind.
		const result = await execFileWithStdin("cat", [], payload);

		assert.strictEqual(result.stdout, payload, "stdin must reach the child byte-for-byte");
		assert.deepStrictEqual(
			fs.readdirSync(dir),
			[],
			"no shell metacharacter in the payload may have executed",
		);
	});

	test("a payload containing a NUL-free binary-ish blob is not truncated", async () => {
		// `git diff` output for a binary file includes control characters; they
		// must survive rather than being interpreted or dropped by encoding.
		const payload = "before\u0007\u001b[31mred\u001b[0m\tafter\rcarriage\\backslash";
		const result = await execFileWithStdin("cat", [], payload);
		assert.strictEqual(result.stdout, payload);
	});
});
