/**
 * Admin session key.
 *
 * Same read as turnstileSecret: the literal is what the bundler inlines, and
 * the bracket wins when the Worker has a runtime binding the build did not
 * inline. This file does not import human-gate.ts, because that module
 * pulls in config.ts and a database read.
 */

function nonempty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function adminSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const own = nonempty(env.ADMIN_SESSION_SECRET) || nonempty(env['ADMIN_SESSION_SECRET']);
  if (own) return own;
  if (env !== process.env) return '';
  return nonempty(process.env.ADMIN_SESSION_SECRET);
}
