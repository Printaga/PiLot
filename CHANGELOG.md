# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [Unreleased]

### Added

- Full integration of PI CLI resource settings (extensions, skills, prompts, system prompts)
- Tool preset configuration now properly passed to PI sessions
- Prompt templates are now included in session resources for webview display

### Fixed

- Extension now properly passes `extraExtensions`, `extraSkills`, `extraPromptTemplates` to PI sessions
- Discovery settings (`disableExtensionDiscovery`, etc.) are now respected in sessions
- Session resources are reloaded when relevant VS Code settings change

## [1.2.0] - 2026-06-07

### Added

- improved support for packages and skills

### Updated

- Updated and simplified README.md documentation

### Fixed

- Fixed PI binary resolution with multiple installations, custom paths, and relative workspace paths
- Made CLI commands respect the `pi-agent.binaryPath` setting instead of hardcoding "pi"
- Added executable permission checks and improved binary validation via PATH
- Added proper error messages when the PI binary is not found
- Removed leftover mock data from the capabilities tab
- Minor fixes to the GUI layout and labels

## [1.1.0] - 2026-06-06

### Added

- Added version check for PI and PI packages in the GUI showing available updates

### Fixed

- Fixed mismatch between PI CLI scoped models and the extension favorite models causing warnings
- Fixed icon display issues

## [1.0.1] - 2026-06-05

### Fixed

- Corrected GitHub URL

## [1.0.0] - 2026-06-05

### Added

- Initial release
