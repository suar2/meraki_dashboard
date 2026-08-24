import axios from "axios";
import type { LogicalGroup, RemediationAction, SavedView, TopologyChange, TopologyGraph } from "../types/topology";

const api = axios.create({
  baseURL: "/api",
});

export const setMerakiApiKey = async (apiKey: string) => api.post("/meraki-api-key", { api_key: apiKey });
export const listOrganizations = async () => (await api.get("/organizations")).data;
export const listNetworks = async (orgId: string) => (await api.get(`/organizations/${orgId}/networks`)).data;
export const fetchTopology = async (orgId: string, networkId: string): Promise<TopologyGraph> =>
  (await api.get(`/topology/${orgId}/${networkId}`)).data;
export const saveLayout = async (org_id: string, network_id: string, positions: Record<string, { x: number; y: number }>) =>
  api.post("/layout", { org_id, network_id, positions });

export const loadLayout = async (orgId: string, networkId: string): Promise<Record<string, { x: number; y: number }>> => {
  const data = (await api.get<Record<string, { x: number; y: number }>>(`/layout/${orgId}/${networkId}`)).data;
  return data && typeof data === "object" ? data : {};
};
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
}) => (await api.post("/entities/merge", payload)).data;

export const fetchChanges = async (orgId: string, networkId: string, window = "24h"): Promise<{ changes: TopologyChange[]; snapshots: Array<{ id: string; captured_at: string; node_count: number }> }> =>
  (await api.get(`/topology/${orgId}/${networkId}/changes`, { params: { window } })).data;

export const fetchValidate = async (orgId: string, networkId: string) =>
  (await api.get(`/topology/${orgId}/${networkId}/validate`)).data;

export const listViews = async (orgId: string, networkId: string): Promise<SavedView[]> => (await api.get(`/views/${orgId}/${networkId}`)).data;
export const saveView = async (orgId: string, networkId: string, view: Partial<SavedView> & { name: string }): Promise<SavedView> =>
  (await api.post(`/views/${orgId}/${networkId}`, view)).data;
export const deleteView = async (orgId: string, networkId: string, viewId: string) => api.delete(`/views/${orgId}/${networkId}/${viewId}`);

export const listGroups = async (orgId: string, networkId: string): Promise<LogicalGroup[]> => (await api.get(`/groups/${orgId}/${networkId}`)).data;
export const saveGroup = async (orgId: string, networkId: string, group: Partial<LogicalGroup> & { name: string }): Promise<LogicalGroup> =>
  (await api.post(`/groups/${orgId}/${networkId}`, group)).data;
export const deleteGroup = async (orgId: string, networkId: string, groupId: string) => api.delete(`/groups/${orgId}/${networkId}/${groupId}`);
