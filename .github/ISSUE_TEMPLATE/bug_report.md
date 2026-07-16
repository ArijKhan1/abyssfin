---
name: Bug report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''

---

> [!IMPORTANT]
> Please build from the latest `main` branch or a recent release artifact before filing issues.

Four considerations:
 - Please do not open bug reports to ask questions. Use GitHub Discussions instead.
 - Please make sure the issue only pertains to Abyssfin. If it also occurs in the web client, report it to [jellyfin-web](https://github.com/jellyfin/jellyfin-web) instead.
 - Please make sure that your issue is not being caused by errors in custom CSS or note that you are using custom CSS.
     - Notably, there have been instances of custom CSS breaking TV mode.
     - You can disable custom CSS under Display in the user settings.
 - Please provide logs. You can drag the log file into the issue to attach it.
     - Windows: `%LOCALAPPDATA%\Abyssfin\profiles\<profile-id>\logs\`
     - Linux: `~/.local/share/abyssfin/profiles/<profile-id>/logs/`
     - macOS: `~/Library/Logs/Abyssfin/<profile-id>/`

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Desktop (please complete the following information):**
 - OS: [e.g. macOS 14, Windows 11, Ubuntu 24.04]
 - Abyssfin version: [e.g. 2.0.0]
 - Jellyfin server version: [e.g. 10.10.3]

**Additional context**
Add any other context about the problem here.
