import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const version = process.argv[2] || '1.85.0';
const exe = await downloadAndUnzipVSCode({ version });
console.log(exe);
