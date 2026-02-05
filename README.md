# Dashboard

A modular dashboard application with React frontend and Express backend.

## Architecture

```
dashboard/
├── agent/      # System stats collection agent (runs on monitored devices)
├── backend/    # Express API server (device registry, CRM proxy)
└── frontend/   # React dashboard UI (Vite + TypeScript + Tailwind)
```

## Quick Start

### Backend

```bash
cd backend
cp .env.example .env  # Edit with your settings
npm install
npm run dev           # Runs on http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev           # Runs on http://localhost:5173
```

### Agent (optional, for system monitoring)

```bash
cd agent
npm install
npm run dev           # Runs on http://localhost:3002
```

## Modules

The dashboard displays widgets as modules. Current modules:

| Module | Description |
|--------|-------------|
| Weather & Time | Current time and weather via OpenWeatherMap API |
| System Stats | CPU, memory, disk usage from registered devices |
| Job Pipeline | Job opportunities from EspoCRM grouped by stage |

### Adding a Module

1. Create a directory in `frontend/src/modules/YourModule/`
2. Export a React component from `index.ts`
3. Register in `frontend/src/App.tsx`:

```typescript
import { YourModule } from '@/modules/YourModule';

const modules: DashboardModule[] = [
  // ...existing modules
  {
    id: 'your-module',
    title: 'Your Module',
    component: YourModule,
    refreshInterval: 60000, // optional, in ms
  },
];
```

## Environment Variables

### Backend (`backend/.env`)

```bash
PORT=3001

# EspoCRM (for Job Pipeline)
ESPO_URL=http://your-espocrm-host:8080
ESPO_USER=admin
ESPO_PASS=your_password
```

### Frontend (`frontend/.env`)

```bash
VITE_API_BASE_URL=http://localhost:3001
VITE_WEATHER_API_KEY=your_openweathermap_key
```

## API Endpoints

### Backend

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/devices` | List registered devices |
| `POST /api/devices` | Register a device |
| `DELETE /api/devices/:id` | Remove a device |
| `GET /api/devices/:id/stats` | Fetch stats from a device |
| `GET /api/crm/pipeline` | Job opportunities grouped by stage |

## Testing

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test

# Agent
cd agent && npm test
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Radix UI
- **Backend**: Express 5, TypeScript, dotenv
- **Testing**: Jest, Testing Library, Supertest
