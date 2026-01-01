# GuildInviteSaver

Automatically collects and saves invite links before leaving a guild.

## Features

- Automatically backs up invite links when leaving a guild
- Manual backup option via context menu
- Sends invite links to a specified Group DM for safekeeping
- Customizable message format for invite notifications

## Installation

1. Enable the plugin in Vencord's settings
2. Configure the target Group DM ID in settings
3. Optionally customize the message format

## Configuration

- **Auto Backup On Leave**: Automatically backup invites when leaving a guild (default: true)
- **Target Group DM ID**: Group DM ID to send invite links to
- **Message Format**: Format string for the invite message (supports placeholders)

## Usage

The plugin will automatically collect invite links when you leave a guild and send them to the configured Group DM. You can also manually trigger a backup by right-clicking a guild and selecting "Backup Invite" from the context menu.

## AI Disclaimer

This plugin was developed with assistance from **Cursor.AI** (Cursor's AI coding assistant). The AI was used to help with code generation, debugging, documentation, and implementation. While AI assistance was utilized, all code and features were reviewed and tested to ensure quality and functionality.

## License

GPL-3.0-or-later
