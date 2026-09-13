import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginSvelte from "eslint-plugin-svelte";

export default [
	{
		ignores: [
			"dist/**",
			"dist-tsc/**",
			"node_modules/**",
			"scripts/**",
			"esbuild.config.mjs",
			"svelte.config.js",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...eslintPluginSvelte.configs["flat/recommended"],
	{
		files: ["src/**/*.svelte"],
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				// Parse <script lang="ts"> blocks with the TypeScript parser.
				parser: tseslint.parser,
			},
		},
		rules: {
			// TypeScript (via svelte-check) verifies globals and DOM lib types in
			// .svelte files; no-undef cannot see type-only globals and is off for
			// TS sources per typescript-eslint guidance.
			"no-undef": "off",
			// Message content is rendered from the PI agent's markdown/tool output
			// by design; the component sanitizes code blocks and the webview CSP
			// restricts script execution. The 5 usages are intentional.
			"svelte/no-at-html-tags": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrors: "none",
				},
			],
		},
	},
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			"no-undef": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrors: "none",
				},
			],
		},
	},
	{
		// Root-level Node utility scripts: plain JS, so no-undef stays on and
		// their real runtime globals must be declared.
		files: ["*.mjs"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		// Plain-JS jsdom component tests: real globals (unlike .svelte/.ts, TS
		// does not check these files), so no-undef stays on and Mocha's tdd
		// interface must be declared.
		files: ["src/test/webview/**/*.mjs"],
		languageOptions: {
			globals: {
				suite: "readonly",
				test: "readonly",
				teardown: "readonly",
			},
		},
	},
	{
		files: ["src/**/*.cjs"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"@typescript-eslint/no-require-imports": "off",
			"no-undef": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrors: "none",
				},
			],
		},
	},
];
