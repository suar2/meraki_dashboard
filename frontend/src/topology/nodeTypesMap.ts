import type { NodeTypes } from "@xyflow/react";
import {
  ApNode,
  ClientGroupNode,
  ClientNode,
  FirewallNode,
  InfraNode,
  PortNode,
  PortGroupNode,
  TrunkHostNode,
  WanNode,
} from "./nodeTypes";

/** Registry is separate from component definitions so HMR can update components without a non-component export in the same file. */
export const nodeTypes: NodeTypes = {
  wanNode: WanNode,
  firewallNode: FirewallNode,
  infraNode: InfraNode,
  apNode: ApNode,
  clientGroupNode: ClientGroupNode,
  clientNode: ClientNode,
  portNode: PortNode,
  trunkHostNode: TrunkHostNode,
  portGroupNode: PortGroupNode,
};
