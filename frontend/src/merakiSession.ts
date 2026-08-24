import { getClientMerakiKey, listNetworks, listOrganizations, setClientMerakiKey } from "./api/client";

/**
 * Deduplicate Meraki bootstrap + org list per API key, and network list per org.
 * Prevents double requests under React StrictMode and HMR re-mounts.
 */
const organizationsByKey = new Map<string, Promise<unknown[]>>();
const networksByOrgId = new Map<string, Promise<unknown[]>>();

export function clearMerakiRequestCaches() {
  organizationsByKey.clear();
  networksByOrgId.clear();
}

export function getOrganizationsForApiKey(apiKey: string): Promise<unknown[]> {
  const key = apiKey.trim();
  if (!key) return Promise.resolve([]);
  if (!organizationsByKey.has(key)) {
    const p = (async () => {
      setClientMerakiKey(key);
      return listOrganizations() as Promise<unknown[]>;
    })().catch((e) => {
      organizationsByKey.delete(key);
      throw e;
    });
    organizationsByKey.set(key, p);
  }
  return organizationsByKey.get(key)!;
}

export function getNetworksForOrg(orgId: string): Promise<unknown[]> {
  if (!orgId) return Promise.resolve([]);
  const cacheKey = `${getClientMerakiKey()}::${orgId}`;
  if (!networksByOrgId.has(cacheKey)) {
    const p = (listNetworks(orgId) as Promise<unknown[]>).catch((e) => {
      networksByOrgId.delete(cacheKey);
      throw e;
    });
    networksByOrgId.set(cacheKey, p);
  }
  return networksByOrgId.get(cacheKey)!;
}
