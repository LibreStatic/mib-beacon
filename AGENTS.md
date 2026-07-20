# Project Guidelines

- Whenever a user may reasonably need or strongly desire to change a setting, any new feature or UI/UX implementation must expose that behavior as a configurable option in the Settings pane.
- Automatically validate every new feature on mobile, tablet, and desktop—using a browser when possible—for misaligned or unreachable components, unscrollable multi-page views, missing platform-specific features, and similar responsive or cross-platform regressions; when reasonably feasible, fix issues found. For native features, also make a quick Android emulator pass when a running emulator or an available SDK AVD exists on the host.
- Perform this validation using subagents in the following fallback order: 5.6 Luna medium; if unavailable, 5.6 Terra medium; if GPT-based subagents are unavailable, try Opus 4.8 medium.
