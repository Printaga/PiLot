# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [Unreleased] - 2026-06-08

### Added
- Auto-detect VS Code executable path for test runner

### Changed
- Updated tooling and logging

### Fixed
- Fixed voice helper path resolution with correct extension ID
- Fixed `context.autoAttach` setting key to match package.json configuration
- Added user-friendly error message when voice helper fails due to missing ALSA libraries on Linux
- Replaced console.log statements in message-handler with proper logDebug calls
- Fixed indentation in listPackagesFromCli error handling for Windows platform

## [1.2.0] - 2026-06-07

### Added

- Full integration of PI CLI resource settings (extensions, skills, prompts, system prompts)

### Updated

- Updated and simplified README.md documentation

### Fixed

- Fixed PI binary resolution with multiple installations, custom paths, and relative workspace paths
- Made CLI commands respect the `pi-agent.binaryPath` setting instead of hardcoding "pi"
- Added executable permission checks and improved binary validation via PATH
- Added proper error messages when the PI binary is not found
- Fix hotkeys documentation to match actual keybindings (Ctrl+Shift+Alt+N)
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
