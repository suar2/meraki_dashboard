import axios from "axios";
import { RemediationAction, TopologyGraph } from "../types/topology";

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
export const executeRemediation = async (org_id: string, network_id: string, action: RemediationAction, actor: string) =>
  api.post("/remediation/execute", { org_id, network_id, action, actor });
export const listAudit = async () => (await api.get("/audit")).data;
