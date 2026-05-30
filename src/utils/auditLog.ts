import { logValidationWarningRemote } from "./db";

interface AuditEntry {
  agent: string
  warnings: string[]
  timestamp: string
}

const auditLog: AuditEntry[] = []

export function logValidationWarning(agent: string, warnings: string[]): void {
  const entry: AuditEntry = { agent, warnings, timestamp: new Date().toISOString() };
  auditLog.push(entry);
  // Also persist to SQLite via server endpoint (fire-and-forget)
  logValidationWarningRemote(agent, warnings);
}

export function getAuditLog(): AuditEntry[] {
  return [...auditLog]
}

export function clearAuditLog(): void {
  auditLog.length = 0
}
