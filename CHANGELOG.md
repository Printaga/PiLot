# Change Log

All notable changes to the PiLot Studio for VS Code extension will be documented in this file.

## [2.3.0] - 2026-07-10

### Added

- Support for the new max thinking level in Pi 0.80.6.
- Support for slash commands for invoking PI CLI built-in commands and available skills.
- Add a button in the **Settings** tab to open the global Pi settings file (`settings.json`), a button in the **Models** tab to open `models.json`, and a button in the **Providers** tab to open `auth.json` for manual editing. This is needed because some providers, such as Cloudflare, require additional manual configuration beyond entering an API key in the GUI.

### Changed

- Improved session auto naming
- Improved test coverage
- Revised TODO.md

### Fixed

- List of available models did not automatically update after the initial provider configuration.
- The current session name was not displayed in the 'Rename Session' dialog.
- Some provider error messages was not exposed to the user.

## [2.2.1] - 2026-07-04

### Changed

- Improved landing page design
- Improved file picker @ search function

### Fixed

- Fixed some files not available in file picker. Increaced limit on files available in file picker from 2000 to 10000
- Package @catdaemon/pi-code-intelligence sqllite3 node compability with VsCode
- Removed redundant extra versions of the landing page.

## [2.2.0] - 2026-07-03

### Added

- "Apply to Editor" button on code blocks — inserts or replaces selection in active editor
- "Preview Diff" button on code blocks — opens VS Code diff editor with proposed changes
- "Open in Editor" button for code blocks
- Code block copy button with clipboard feedback
- Message-level copy button for assistant responses
- Add support for forking sessions from existing ones
- Chat search (Ctrl+F) to highlight matching text in messages
- Markdown table rendering
- Timestamp toggle (relative ↔ absolute)
- Markdown header anchors for linking
- Expanded empty state quick actions (Debug Issue, Write Tests)

### Changed

- Message actions (copy, timestamp toggle, fork) appear on hover
- Refactor to minimize code bloat.
- Significantly improved test coverage

### Fixed

- Added missing ordered list rendering support
- Fixed duplicate CSS for message actions
- Fixed missing default skill paths

## [2.1.0] - 2026-06-23

### Added

- Add dedicated Skills tab in the PiLot Studio sidebar for viewing PI CLI skills and defining skill directories
- Add scroll to bottom button in the chat window for quick access

### Changed

- Refactored PiAgentProvider (2719 → 1779 lines) by extracting 6 modules: BinaryService, FooterManager, ExtensionUIContext, ModelRegistryHandler, PackageManager, SessionListManager
- Created `binary-service.ts` consolidating binary resolution, PATH management, and git branch detection
- Created `footer-manager.ts` for git branch polling and footer data synchronization
- Created `extension-ui-context.ts` for extension UI binding, status polling, and loading error forwarding
- Created `model-registry-handler.ts` for model registry merging, favorites sync, and CLI model caching
- Created `package-manager.ts` for package CLI operations, enrichment, and CRUD
- Created `session-manager.ts` for session list caching, auto-naming, and deletion

### Fixed

- Fixed BinaryService using console.log/console.error instead of proper logging infrastructure; now accepts logDebug/logError callbacks like all other services
- Fixed non-functional types filter for available packages
- Fixed missing ARIA listbox pattern implementation
- Clean up child processes on session shutdown
- Fixed truncated skill tooltip in context section.
- Added missing `getSettings` and `setToolConfig` message handlers in MessageHandler
- Added missing `getSettings()` and `setToolConfig()` methods to PiAgentProvider for VS Code configuration integration
- Fixed forkSession message to pass `fromNodeId` instead of `sessionId` parameter
- Fixed ToolsPanel to receive and sync `toolPreset` prop from App.svelte state
- Fixed ToolsPanel to send correct data format (`toolPreset`, `customTools`) in setToolConfig messages
- Removed redundant activation events from package.json

## [2.0.2] - 2026-06-11

### Fixed

- Fixed edge issues with manually set PI binary resolution on Windows. findGlobalPiInstallation() now checks setting first → PATH → hardcoded paths
- Fixed extractNodeModulesPath() to handle Windows \ path separators

## [2.0.1] - 2026-06-11

### Added

- New tooltip for the top left icon showing the current version of the extension and PI binary
- More detailed information about installed PI packages

### Changed

- "Show more (x older messages)" option moved from the bottom of the chat window to the top of the GUI for easier access
- Cleaned up Settings & Help tab

### Fixed

- Fixed an edge case where the app uses the wrong PI binary path
- Removed hardcoded Home Directory fallback path in Native Addons
- Removed duplicate package/extension display in the GUI context view
- Fixed missing error handling for critical paths in the PI binary resolution logic
- Fixed StatusLine uses non-existent events
- Fixed incorrect keyboard shortcut hints
- Fixed auto context toggle in settings
- Fixed debug logging bypasses Diagnostics setting
- Removed unused CSS selectors
- Multiple minor issues fixed

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
