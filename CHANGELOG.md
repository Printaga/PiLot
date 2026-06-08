# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [2.0.0] - 2026-06-09

### Added

- ActivityBar component with tool argument previews and detailed compaction statuses
- Automatic session name generation from conversation content
- Session deletion command
- Resizable chat window for better user experience
- Interactive branching/forking functionality with visual indicator for resource changes
- Inline help system and onboarding tour for new users
- Message editing feature for user messages
- Quick actions and shortcuts for common tasks
- Prompt templates feature with editable starter text
- ResourceBadge component with change indicator animation
- SkeletonLoader component for loading states
- Toast notification component for persistent error/system messages
- Voice manager for microphone input with ALSA error handling on Linux
- Slash commands support (/model, /new, /compact, /export, /copy, /fork, /session, etc.)
- ProviderApi interface for decoupled message handling
- getSessionResources message handler for session resource data
- Unit tests for shell utilities, message serialization, and session resources

### Changed

- Refactored codebase structure breaking MessageHandler circular dependencies
- Removing bundeled PI binary from the extension package, rely on the users' PI binary installation
- Industrial monospace theme overhaul for the entire UI
- Extension UI context binding to prevent double initialization
- Extracted binary resolution into dedicated pi-binary.ts module
- Extracted shell utilities into dedicated utils/shell.ts module
- Extracted message serialization into dedicated message-serializer.ts module
- Reorganized session resource management into session-resources.ts module
- Removed unused Svelte 5 store modules (moved to rune-based state)

### Fixed

- Fixed voice helper path resolution with correct extension ID
- Fixed `context.autoAttach` setting key to match package.json configuration
- Added user-friendly error message when voice helper fails due to missing ALSA libraries on Linux
- Fixed hotkeys documentation to show correct `Ctrl+Shift+Alt+N` for New Session
- Replaced console.log statements in message-handler with proper logDebug calls
- Fixed indentation in listPackagesFromCli error handling for Windows platform
- Fixed execFileAsync to return error code 1 instead of 0 on command failures
- Fixed HelpTooltip event binding and formatting
- Fixed extension UI context binding to preserve state across session reloads
- Added empty state placeholder for ActivityBar when no activities are active

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
