This directory contains the vendored offline dictation assets used by the extension host.

`pi-voice-helper` handles native macOS microphone capture and local transcription, and `whisper.framework` is the official `whisper.cpp` XCFramework runtime slice bundled for macOS.

`pi-voice-helper-linux-x64`, `pi-voice-helper-linux-arm64`, `pi-voice-helper-win32-x64.exe`, and `pi-voice-helper-win32-arm64.exe` are the cross-platform helper builds for Linux and Windows. The extension host owns download progress, model caching, helper selection, and sidebar state updates while keeping dictation fully local on-device after the one-time model download.

Linux helpers may dynamically link normal platform libraries such as ALSA and glibc, but release packaging rejects separate C++ runtime dependencies. Windows helpers are built with the MSVC static runtime so they do not depend on separate C or C++ runtime redistributables.
