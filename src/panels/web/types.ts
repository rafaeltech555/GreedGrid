/** Config for the Web/URL panel. */
export interface WebConfig {
  url: string;
}

/** A web panel is ready once it has a non-empty url. */
export function webReady(config: Record<string, unknown>): boolean {
  return typeof config.url === "string" && config.url.trim().length > 0;
}
