import axios, { type InternalAxiosRequestConfig } from "axios";
import type { LogicalGroup, RemediationAction, SavedView, TopologyChange, TopologyGraph } from "../types/topology";
import { loadEntityMerges, saveEntityMergeRecord, type EntityMergeRecord } from "../topology/entityMerge";

const api = axios.create({
  baseURL: "/api",
});

const MERAKI_SESSION_KEY = "meraki-ops-session-api-key";
const LAYOUT_PREFIX = "meraki-ops-layout";

function getSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function getLocal(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(storage: Storage | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

let clientMerakiKey = getSession()?.getItem(MERAKI_SESSION_KEY)?.trim() || "";

export function setClientMerakiKey(apiKey: string): void {
  clientMerakiKey = apiKey.trim();
  const storage = getSession();
  if (!storage) return;
  if (clientMerakiKey) storage.setItem(MERAKI_SESSION_KEY, clientMerakiKey);
  else storage.removeItem(MERAKI_SESSION_KEY);
}

export function getClientMerakiKey(): string {
  return clientMerakiKey;
}

export function clearClientMerakiKey(): void {
  clientMerakiKey = "";
  getSession()?.removeItem(MERAKI_SESSION_KEY);
}

export function applyMerakiApiKeyHeader<T extends { headers?: unknown }>(config: T): T {
  const key = clientMerakiKey.trim();
  const url = "url" in config ? String((config as { url?: unknown }).url || "") : "";
  if (!key || !shouldAttachMerakiApiKey(url)) return config;
  const headers = (config.headers || {}) as Record<string, string> & { set?: (name: string, value: string) => void };
  if (typeof headers.set === "function") headers.set("X-Meraki-Api-Key", key);
  else headers["X-Meraki-Api-Key"] = key;
  config.headers = headers;
  return config;
}

function shouldAttachMerakiApiKey(url: string): boolean {
  if (!url) return true;
  const path = url.split("?", 1)[0];
  if (path === "/organizations") return true;
  if (/^\/organizations\/[^/]+\/networks$/.test(path)) return true;
  if (/^\/topology\/[^/]+\/[^/]+\/validate$/.test(path)) return true;
  if (/^\/topology\/[^/]+\/[^/]+$/.test(path)) return true;
  if (path === "/remediation/execute") return true;
  return false;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => applyMerakiApiKeyHeader(config));

export function layoutStorageKey(orgId: string, networkId: string): string {
  return `${LAYOUT_PREFIX}-${orgId}-${networkId}`;
}

export const listOrganizations = async () => (await api.get("/organizations")).data;
export const listNetworks = async (orgId: string) => (await api.get(`/organizations/${orgId}/networks`)).data;
export const fetchTopology = async (orgId: string, networkId: string): Promise<TopologyGraph> =>
  (await api.get(`/topology/${orgId}/${networkId}`)).data;

export const saveLayout = async (org_id: string, network_id: string, positions: Record<string, { x: number; y: number }>) =>
  writeJson(getLocal(), layoutStorageKey(org_id, network_id), positions);

export const loadLayout = async (orgId: string, networkId: string): Promise<Record<string, { x: number; y: number }>> => {
  return getStoredLayoutPositions(orgId, networkId);
};

export function getStoredLayoutPositions(orgId: string, networkId: string): Record<string, { x: number; y: number }> {
  const data = readJson<Record<string, { x: number; y: number }>>(getLocal(), layoutStorageKey(orgId, networkId), {});
  return data && typeof data === "object" ? data : {};
}

export const executeRemediation = async (org_id: string, network_id: string, action: RemediationAction, actor: string) =>
  api.post("/remediation/execute", { org_id, network_id, action, actor });
export const listAudit = async () => (await api.get("/audit")).data;

export const saveEntityMerge = async (payload: {
  org_id: string;
  network_id: string;
  survivor_id: string;
  member_ids: string[];
  label: string;
  device_class: string;
  interfaces: Array<{ switch_serial: string; port_id: string; role: string; member_id: string }>;
}): Promise<EntityMergeRecord> => saveEntityMergeRecord(payload);

export const listEntityMerges = async (orgId: string, networkId: string): Promise<EntityMergeRecord[]> => loadEntityMerges(orgId, networkId);

export const fetchChanges = async (orgId: string, networkId: string, window = "24h"): Promise<{ changes: TopologyChange[]; snapshots: Array<{ id: string; captured_at: string; node_count: number }> }> =>
  (await api.get(`/topology/${orgId}/${networkId}/changes`, { params: { window } })).data;

export const fetchValidate = async (orgId: string, networkId: string) =>
  (await api.get(`/topology/${orgId}/${networkId}/validate`)).data;

export const listViews = async (_orgId: string, _networkId: string): Promise<SavedView[]> => [];
export const saveView = async (orgId: string, networkId: string, view: Partial<SavedView> & { name: string }): Promise<SavedView> =>
  Promise.reject(new Error("Shared views are unavailable in strict privacy mode."));
export const deleteView = async (_orgId: string, _networkId: string, _viewId: string) => undefined;

export const listGroups = async (_orgId: string, _networkId: string): Promise<LogicalGroup[]> => [];
export const saveGroup = async (orgId: string, networkId: string, group: Partial<LogicalGroup> & { name: string }): Promise<LogicalGroup> =>
  Promise.reject(new Error("Shared groups are unavailable in strict privacy mode."));
export const deleteGroup = async (_orgId: string, _networkId: string, _groupId: string) => undefined;
