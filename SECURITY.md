# Security

Dictalume sends audio and text directly to the providers configured by the user. The project does not operate an intermediary transcription service.

## Sensitive data

Never commit or attach any of the following:

- API keys or `.env` files
- Google OAuth client IDs or tokens
- Apple signing certificates, provisioning profiles, or Team IDs
- `settings.json`, `history.json`, `meetings.json`, `calendar.json`, `sync.json`, or `context.json`
- recordings, transcripts, calendar exports, or screenshots containing private information

Run `pnpm privacy:check` before every commit. GitHub Actions runs the same check automatically.

## Reporting a vulnerability

Use GitHub’s private vulnerability-reporting feature when it is enabled for the repository. Do not include credentials, transcripts, recordings, or personal information in a public issue.
