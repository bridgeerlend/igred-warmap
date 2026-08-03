/**
 * A source that cannot run because it has not been set up yet — a missing API token, say.
 * Distinct from an outage: nothing is broken, something is simply not configured, so it
 * must not be reported as a failure that pages someone.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
