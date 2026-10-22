import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers';

const execFileAsync = promisify(execFile);

/**
 * The token the HTTP proxy's own documentation uses for local Redis.
 * It is not a credential for any hosted store.
 */
const TOKEN = 'example_token';

/** Small image. The proxy, not this port, is what the app speaks. */
const REDIS_IMAGE = 'redis:7-alpine';

/**
 * HTTP front that speaks the Upstash REST API. Vercel KV is that API, so a
 * bare TCP Redis would not be a stand-in for it.
 */
const HTTP_IMAGE = 'hiett/serverless-redis-http:latest';

export interface KvStandIn {
  /** Upstash / Vercel KV REST URL, with no trailing slash. */
  url: string;
  token: string;
  stop(): Promise<void>;
}

/**
 * Whether a container runtime answers.
 *
 * A missing binary, a stopped daemon and a permission error are all "no".
 * Callers skip. A suite that required Docker would fail CI, and a Vercel
 * build, on machines that do not have it.
 */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start Redis behind an Upstash-compatible HTTP proxy.
 *
 * Returns undefined when Docker is not available, so the caller can skip.
 * When Docker is available and the containers fail to start, the error
 * propagates: a runtime that claims to be up and then cannot run Redis is a
 * failure, not a skip.
 */
export async function startKvStandIn(): Promise<KvStandIn | undefined> {
  if (!(await dockerAvailable())) return undefined;

  const network = await new Network().start();
  const started: StartedTestContainer[] = [];
  try {
    started.push(
      await new GenericContainer(REDIS_IMAGE)
        .withNetwork(network)
        .withNetworkAliases('redis')
        .withExposedPorts(6379)
        .withStartupTimeout(120_000)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start(),
    );
    const http = await new GenericContainer(HTTP_IMAGE)
      .withNetwork(network)
      .withEnvironment({
        SRH_MODE: 'env',
        SRH_TOKEN: TOKEN,
        SRH_CONNECTION_STRING: 'redis://redis:6379',
      })
      .withExposedPorts(80)
      .withStartupTimeout(120_000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    started.push(http);

    const url = `http://${http.getHost()}:${http.getMappedPort(80)}`;
    return {
      url,
      token: TOKEN,
      async stop() {
        await stopAll(started, network);
      },
    };
  } catch (error) {
    await stopAll(started, network);
    throw error;
  }
}

async function stopAll(
  containers: StartedTestContainer[],
  network: { stop(): Promise<unknown> },
): Promise<void> {
  for (const container of containers.reverse()) {
    await container.stop().catch(() => undefined);
  }
  await network.stop().catch(() => undefined);
}
