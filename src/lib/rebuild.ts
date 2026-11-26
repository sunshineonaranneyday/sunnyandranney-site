/**
 * Asks for a website rebuild through the DeployCoordinator Durable Object (the same
 * debounced queue Shopify's product webhooks use: one build 15 to 30 minutes after the
 * last change). Never throws: a missed poke is caught by the next one.
 */
interface RebuildEnv {
  DEPLOY_COORDINATOR?: DurableObjectNamespace;
  SYNC_SECRET?: string;
}

export async function pokeRebuild(env: RebuildEnv, why: string): Promise<boolean> {
  if (!env.DEPLOY_COORDINATOR || !env.SYNC_SECRET) return false;
  try {
    const stub = env.DEPLOY_COORDINATOR.get(env.DEPLOY_COORDINATOR.idFromName('singleton'));
    const res = await stub.fetch(new Request('https://do/poke', { method: 'POST', headers: { 'X-Poke-Secret': env.SYNC_SECRET } }));
    console.log(JSON.stringify({ at: 'rebuild', why, ok: res.ok }));
    return res.ok;
  } catch (err) {
    console.error('Rebuild poke failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
