# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [1.3.0] - 2026-06-08

### Added

- New slash commands support
- Added nteractive branching/forking functionality
- Added persistent toast notifications for errors and system messages
- New inline help system and onboarding
- New message editing feature
- Quick actions and shortcuts for common tasks
- Improved session management and history tracking
- Visual indicator when resources change (new extensions/skills loaded)
- Enhanced tool controls integration with PI agent's tool configuration
- Improved keyboard navigation and focus management
- Better loading states and skeleton UI for models/packages
- Progress indicators during session creation
- Better feedback for long-running operations (compact, update)
- New voice manager for microphone input
- Auto-detect VS Code executable path for test runner
- Webview stores for model, session, and UI state
- HTML export with syntax highlighting.

### Changed

- Major refactor: extracted binary resolution into dedicated module
- Extracted shell utilities and message serialization
- Reorganized session resource management
- Minor GUI/design improvements

### Fixed

- Fixed voice helper path resolution with correct extension ID
- Fixed `context.autoAttach` setting key to match package.json configuration
- Added user-friendly error message when voice helper fails due to missing ALSA libraries on Linux
- Replaced console.log statements in message-handler with proper logDebug calls
- Fixed indentation in listPackagesFromCli error handling for Windows platform

## [1.2.0] - 2026-06-07

### Added

- Full integration of PI CLI resource settings (extensions, skills, prompts, system prompts)

### Changed

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
