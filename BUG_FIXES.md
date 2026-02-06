# Bug Fixes

## 2026-02-04: Frontend error object rendering crash

**Affected components:** `WeeklyTodos.tsx` (fixed), `Contacts.tsx`, `JobPipeline.tsx` (same bug, not yet fixed)

**Symptom:** Dashboard crashes with "Objects are not valid as a React child (found: object with keys {message, code})"

**Root cause:** Backend error responses return `error` as an object `{message, code}`, but frontend components passed this directly to `setError()` and tried to render it as a string.

**Backend error format:**
```json
{
  "success": false,
  "error": {
    "message": "Weekly note not found: 2026 Week 06.md",
    "code": "INTERNAL_ERROR"
  }
}
```

**Broken code:**
```typescript
setError(json.error || 'Failed to load...');
```

**Fix:**
```typescript
const errorMsg = typeof json.error === 'object' ? json.error?.message : json.error;
setError(errorMsg || 'Failed to load...');
```

**Test added:** `WeeklyTodos.test.tsx` - "shows error message when API returns error object"
