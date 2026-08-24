declare module "cytoscape-fcose" {
  const ext: (cytoscape: typeof import("cytoscape")) => void;
  export default ext;
}
