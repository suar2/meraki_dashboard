import { listNetworks, listOrganizations, setMerakiApiKey } from "./api/client";

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
      await setMerakiApiKey(key);
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
  if (!networksByOrgId.has(orgId)) {
    const p = (listNetworks(orgId) as Promise<unknown[]>).catch((e) => {
      networksByOrgId.delete(orgId);
      throw e;
    });
    networksByOrgId.set(orgId, p);
  }
  return networksByOrgId.get(orgId)!;
}
