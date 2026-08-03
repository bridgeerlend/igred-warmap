import type { SourceHealth } from '../schema/artifact.js';
import type { SourceDefinition } from '../schema/config.js';
import { ConfigurationError } from './errors.js';

export interface SourceOutcome<T> {
  data: T | undefined;
  health: SourceHealth;
}

export interface PreviousHealth {
  lastSuccessAt?: string | undefined;
  consecutiveFailures: number;
}

/**
 * Runs one source in isolation. A source that throws never aborts the run: it reports
 * failure, the caller keeps the previous good data for that source, and the rest continues.
 */
export async function runSource<T>(
  definition: SourceDefinition,
  previous: PreviousHealth,
  fetcher: () => Promise<{ data: T; recordCount: number }>,
  now: string,
): Promise<SourceOutcome<T>> {
  if (!definition.enabled) {
    return {
      data: undefined,
      health: {
        sourceId: definition.id,
        status: 'ok',
        lastAttemptAt: now,
        ...(previous.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
        consecutiveFailures: previous.consecutiveFailures,
        recordsLastRun: 0,
        message: 'disabled in config/sources.json',
        servedFromLastGood: true,
      },
    };
  }

  try {
    const { data, recordCount } = await fetcher();
    return {
      data,
      health: {
        sourceId: definition.id,
        status: 'ok',
        lastAttemptAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        recordsLastRun: recordCount,
        servedFromLastGood: false,
      },
    };
  } catch (error) {
    const consecutiveFailures = previous.consecutiveFailures + 1;
    const hoursSinceSuccess = previous.lastSuccessAt
      ? (Date.parse(now) - Date.parse(previous.lastSuccessAt)) / 3_600_000
      : Number.POSITIVE_INFINITY;

    // An unconfigured source is a setup state, not an outage — it must not raise an alarm
    // every hour on a fresh repository.
    const status =
      error instanceof ConfigurationError
        ? 'not_configured'
        : hoursSinceSuccess > definition.staleAfterHours
          ? 'failed'
          : 'degraded';

    return {
      data: undefined,
      health: {
        sourceId: definition.id,
        status,
        lastAttemptAt: now,
        ...(previous.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
        consecutiveFailures,
        recordsLastRun: 0,
        message: (error as Error).message.slice(0, 300),
        servedFromLastGood: true,
      },
    };
  }
}

export function overallStatus(entries: SourceHealth[]): 'ok' | 'degraded' | 'failed' {
  if (entries.some((entry) => entry.status === 'failed')) return 'failed';
  if (entries.some((entry) => entry.status === 'degraded' || entry.status === 'not_configured')) {
    return 'degraded';
  }
  return 'ok';
}
