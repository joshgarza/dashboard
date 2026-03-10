# Dashboard

Personal productivity dashboard that aggregates calendar, tasks, weather, and CRM data into a single interface, with built-in AI tools for research and weekly review.

## Features

| Widget | Description |
|--------|-------------|
| The Schedule | Today's events from Google Calendar |
| Today's Plan | Todos pulled from the weekly review plan stored in Hopper |
| Weather & Time | Current conditions via OpenWeatherMap |
| Job Pipeline | Job opportunities by stage from EspoCRM |
| Research Chat | AI-powered assistant for queuing and exploring research tasks |
| Weekly Review | Interview-style weekly planning and reflection tool |

## Architecture

```
dashboard/
├── agent/      # System stats collection agent (runs on monitored devices)
├── backend/    # Express API server
└── frontend/   # React dashboard UI
```

## Quick Start

### Backend

```bash
cd backend
cp .env .env.local  # Edit with your settings
npm install
npm run dev         # Runs on http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev         # Runs on http://localhost:5173
```

### Agent (optional, for system monitoring)

```bash
cd agent
npm install
npm run dev         # Runs on http://localhost:3002
```

## Environment Variables

### Backend

```bash
PORT=3001
ESPO_URL=http://your-espocrm-host
ESPO_USER=your_username
ESPO_PASS=your_password
OBSIDIAN_VAULT_PATH=/path/to/your/vault
CODEX_MODEL=gpt-5.3-codex  # optional
```

AI features run through the Codex SDK, which wraps the local Codex CLI. In Docker, backend auth comes from the mounted `~/.codex` directory in `docker-compose.yml`. This path is intended to use your ChatGPT-backed Codex login rather than paid API-key billing.

### Frontend

```bash
VITE_API_BASE_URL=http://localhost:3001
VITE_WEATHER_API_KEY=your_openweathermap_key
VITE_WEATHER_CITY=your_city
```

`VITE_WEATHER_CITY` is documented for the intended weather configuration, but the current widget still uses a hardcoded city and needs a follow-up cleanup.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, Radix UI
- **Backend:** Express 5, TypeScript
- **Integrations:** Google Calendar, EspoCRM, Obsidian, Hopper DB, Codex SDK
- **Testing:** Jest, Testing Library, Supertest
