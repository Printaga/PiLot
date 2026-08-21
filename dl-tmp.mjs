import { downloadAndUnzipVSCode } from '@vscode/test-electron';
const p = await downloadAndUnzipVSCode();
console.log('VSCODE_PATH=' + p);
