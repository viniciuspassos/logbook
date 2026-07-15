Project Idea:
Build an offline-first Progressive Web App (PWA) for mountaineers and skydivers to record their adventures, even in places with little or no internet connectivity. The application should leverage on-device Browser AI APIs instead of cloud-based LLMs whenever possible.

## Project Goal

Create a digital adventure logbook where users can quickly capture their experiences through voice or short text. Local AI should organize, enrich, and rewrite these notes into structured records without requiring an internet connection.

## Core Features

### Voice Capture

- Use the Web Speech API to convert speech into text.
- Users should be able to create entries entirely by voice.

### Structured Data Extraction

Use the Browser Prompt API to extract structured information from free-form text, such as:

- Activity type (Skydiving, Hiking, Climbing, Trekking, etc.)
- Location
- Date
- Weather conditions
- Equipment used
- Route or climb grade
- Jump altitude
- Duration
- Difficulty
- Participants
- Personal notes
- Adrenaline or effort level

The extracted data should be stored in a structured format.

### AI Rewriting

Use the Browser Rewriter API to transform rough notes into polished adventure stories suitable for sharing on social media or keeping as a personal journal.

Example:

Input:
"I climbed Pico da Bandeira today. Really windy. Used helmet and ropes. It was exhausting but worth it."

Output:
A well-written first-person adventure story.

## Offline First

The application must:

- Work completely offline.
- Store all data locally using IndexedDB.
- Cache application assets with a Service Worker.
- Never require cloud AI services for core functionality.
- Synchronize optional backups only when internet connectivity is available.

## Additional Features

Include support for:

- Timeline of adventures
- Search through previous logs
- AI-powered natural language search
- Statistics dashboard
- Photo attachments
- Export to Markdown
- Export to PDF
- Local backups using the File System Access API

## Suggested Tech Stack

- TypeScript
- React
- Vite
- Progressive Web App
- IndexedDB
- Service Workers
- Browser Prompt API
- Browser Rewriter API
- Web Speech API
- File System Access API

## Architecture Guidelines

The generated CLAUDE.md should include:

- Project overview
- Folder structure
- Architecture decisions
- Coding standards
- Component organization
- State management guidelines
- Error handling
- Accessibility
- Testing strategy
- Performance recommendations
- Offline-first principles
- Browser AI best practices
- PWA best practices
- Security considerations
- Git workflow
- Pull request expectations

## Development Principles

- Prefer native browser APIs over third-party libraries.
- Keep AI processing entirely on-device whenever possible.
- Favor simple, maintainable solutions.
- Write modular and reusable code.
- Use strict TypeScript.
- Prefer functional React components.
- Document non-obvious decisions.
- Keep the project easy for both humans and AI coding assistants to understand.

The resulting CLAUDE.md should serve as the main development guide for contributors and AI coding assistants working on the project.
