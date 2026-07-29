# Granola feature-parity audit

This is a living, evidence-based audit of Dictalume against Granola's public product
documentation. “Complete” means the current repository contains the feature and a relevant
build, test, or runtime check covers it. It does not mean that a similarly named but narrower
feature exists.

Reference index: [Granola Docs](https://docs.granola.ai/llms.txt).

## Personal meeting workflow

| Capability | Status | Dictalume evidence / remaining work |
| --- | --- | --- |
| Live microphone + system-audio transcription | Complete | Separate audio tracks, 30-second live chunks, pause/resume, search, per-chunk copy/delete, and long recordings. |
| Floating meeting controller | Complete | Recording, paused, reviewing, and processing states on macOS and Windows. |
| Calendar start, reminders, and auto-stop | Complete | Google and Outlook calendars, explicit arming, scheduled start/end signals, call-source end, suspend, and silence handling. |
| Google Meet speaker tags | Complete, unpacked extension | Visible active-speaker display names pass through a loopback-only bridge and are accepted only for short consistent intervals. Chrome Web Store publication is external work. |
| Zoom speaker tags | Complete on macOS, runtime needs a real call | Accessibility polling is active only while a Zoom meeting is recording. Names require an explicit speaking signal. Granola documents the same macOS limitation. |
| In-person speaker diarization on iPhone | Complete | Deepgram acoustic diarization, anonymous voice clusters, mandatory human review, Unknown speaker fallback, and speaker-labelled transcript sharing. |
| Human speaker correction before AI | Complete | Notes are not requested until evidence labels are confirmed; saved transcript turns can be reassigned later. |
| AI-enhanced notes | Complete | Summary, key points, decisions, to-do list, open questions, and full transcript. |
| Note-to-transcript evidence | Complete for newly generated notes | Each generated item may cite real transcript-turn IDs. Invalid IDs are discarded; the UI reveals exact speaker-labelled passages. |
| User notes during a meeting | Complete | Desktop Markdown headings/emphasis/lists and local image attachments; iPhone headings/bullets while recording and editing during speaker review; both guide generation without replacing transcript evidence. Images are deliberately not sent to the notes AI. |
| Edit notes and complete tasks | Complete | Local editing without an AI call and interactive task completion. |
| Templates and recipes | Complete | Built-in and custom templates/recipes, regeneration, follow-up draft, decisions, and actions. |
| Per-meeting and cross-meeting chat | Complete | User-selected configured text provider, persistent meeting chat, and library retrieval. |
| Resume a meeting | Complete | New audio/transcript turns append to the existing meeting and notes regenerate across the full record. |
| People and Companies | Complete for local use | Derived from calendar attendees and confirmed named speakers. |
| Trash, restore, and permanent delete | Complete | Soft delete, restore, permanent deletion, and transcript-only retention. |
| Export | Complete | Markdown/JSON per meeting and bulk CSV including transcripts (broader than Granola's documented bulk CSV). |

## Mobile and continuity

| Capability | Status | Dictalume evidence / remaining work |
| --- | --- | --- |
| iPhone 15 recording and notes | Complete | Long background audio, pause/resume, audio-interruption and route-change recovery; iOS 17+ SwiftUI builds pass for universal simulator and generic ARM64 device; the installed app and its live-meeting-notes layout are visually checked on an iPhone 15 simulator. |
| iPhone Coming Up calendar | Complete for device-local calendars | Explicit EventKit full-access permission, 14-day in-progress/upcoming list, one-tap in-person recording, correct event title through history and desktop sync, and no calendar body/attendee upload. Permission, empty, and populated states are visually checked on an iPhone 15 simulator. |
| Granola-style chat on iPhone | Complete for personal meetings | Questions use at most 20 recent saved meetings and eight prior turns, with explicit source-title/date grounding, no unsupported speaker/fact/task inference, persisted local chat, clear/error/loading states, and a visually checked iPhone 15 UI. |
| Action Button / Shortcuts | Complete | Separate App Intents open Dictalume and immediately begin dictation or a diarized meeting. Back Tap is documented for iPhone 15/15 Plus. |
| Dictation keyboard | Complete within iOS limits | The containing app records; the keyboard inserts the latest transcript through an App Group. |
| Mac/Windows/iPhone shared context | Complete for one owner | User-selected iCloud/OneDrive/Dropbox folder; an iPhone meeting becomes a first-class desktop meeting with confirmed speakers, timed turns, user notes, generated notes, and full transcript; secrets stay in each device Keychain/DPAPI. |
| Phone-call capture | Missing | Requires a dedicated iOS call workflow and legal/consent UX. |
| Apple Watch | Missing | Requires a watchOS target and phone handoff. |
| Android | Out of the user's stated device scope | Granola now documents Android support; Dictalume currently targets macOS, Windows, and iPhone. |

## Organization, sharing, and automation

| Capability | Status | Dictalume evidence / remaining work |
| --- | --- | --- |
| Spaces | Complete for private/local use | Nested folders, descriptions, icons, descendant filtering, recurring calendar-series and exact-title auto-add, many-to-many meeting membership, legacy migration, and shared-folder sync. Team sharing still depends on the workspace backend below. |
| Pre-meeting briefs | Partial | Calendar + prior Dictalume meetings are supported. Overnight jobs, wider-web research, Gmail context, and citations are not. |
| Follow-up emails | Partial | A faithful follow-up recipe exists. Gmail context, draft creation, and send flow do not. |
| Workspaces and team membership | Missing | Requires identity, membership, roles, invitations, and server-side authorization. |
| Note/folder sharing links | Missing | Requires an authenticated web viewer, link tokens, and privacy controls. |
| User groups and admin controls | Missing | Requires the workspace backend. |
| Slack, Notion, Zapier, CRM integrations | Missing | Requires external OAuth/app registrations and a durable event-delivery service. |
| Public API, MCP, and webhooks | Missing | Requires stable server-side authentication, scopes, pagination, signing, retries, and audit logs. |
| Automated consent chat message | Complete to Granola's documented scope; real-call validation pending | Explicit opt-in, editable disclosure, Zoom-only macOS Accessibility automation, Zoom-focused guard, other-speaker signal, self-speaker rejection, retry throttle, and exactly-once gate. AppleScript syntax and gating are tested; a real multi-party Zoom call is still required to validate the current Zoom accessibility tree. |
| Video watermark / virtual camera | Missing | Requires signed native virtual-camera components on macOS and Windows. |
| Enterprise compliance claims | Not claimed | SOC 2, HIPAA/BAA, SSO/SCIM, audit retention, MDM, and legal/compliance programs cannot be created by UI parity alone. |

## Required architecture for the missing cloud features

The existing shared-folder sync remains the private, no-account default. Team and public
features should be an optional companion service so a personal Dictalume installation does
not silently upload meetings.

The companion service needs:

1. accounts, sessions, workspaces, memberships, groups, and role-based access;
2. encrypted note/folder storage with private-by-default row-level authorization;
3. expiring/revocable public and invited-person share tokens;
4. OAuth connector storage isolated from desktop API keys;
5. a durable job queue for overnight briefs, integrations, webhooks, and retries;
6. scoped API keys, pagination, webhook signing, rate limits, and audit logs;
7. a read-only web viewer that never exposes transcripts through public summary links;
8. explicit migration and deletion/export controls.

Choosing a hosting/auth stack is a material product decision. It affects recurring cost,
data residency, public-link reliability, OAuth callback URLs, and whether the repository
remains genuinely self-hostable. That choice must be made before implementing the missing
team/cloud rows.
