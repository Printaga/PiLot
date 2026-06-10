# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [Unreleased]

### Added

- Tooltip for the top left icon showing the current version of the extension and PI binary

## [2.0.0] - 2026-06-09

### Added

- Activity Bar component status messages and information
- Toast notifications and improved error messages
- Session select and delete
- Session export feature
- Resizable chat window for an improved user experience
- Onboarding tour for new users, including new tooltips
- Prompt templates feature with editable starter text
- ResourceBadge component with change-indicator animations
- TODO.md file for future development and improvements

### Changed

- Removed the bundled PI binary from the extension package; the extension now relies on the user's local PI binary installation
- Major GUI and design overhaul
- Major codebase refactoring
- Documentation update

### Fixed

- Fixed a major issue preventing PI packages from working in the VS Code extension
- Fixed numerous minor issues

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
