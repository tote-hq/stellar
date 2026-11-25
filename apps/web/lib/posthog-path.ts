/**
 * The same-origin path the browser uses for PostHog.
 *
 * One constant, no imports: the Worker and the client bundle both have to
 * name this path, and a relative import with no extension would fail under
 * `node --experimental-strip-types`.
 */
export const POSTHOG_PROXY_PATH = '/s7k';
