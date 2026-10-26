// Data access for the behaviour-tree editor (/main-tree/* endpoints).
// All query keys start with "tree" so invalidate.tree() refreshes them.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { convertSubtree, indexNodeTypes } from "./treeModel";

const BASE = "/main-tree";

// List endpoints answer either [{id}] or { message, subtrees: [] } when empty.
const ids = (data) => {
  const list = Array.isArray(data) ? data : Array.isArray(data?.subtrees) ? data.subtrees : [];
  return list.map((s) => s?.id).filter(Boolean);
};

export const treeKeys = {
  nodeTypes: ["tree", "node-types"],
  subtrees: ["tree", "subtrees"],
  undo: ["tree", "undo-state"],
  doDi: ["tree", "do-di-subtrees"],
  subtree: (id) => ["tree", "subtree", id],
  preview: (kind, id) => ["tree", "preview", kind, id],
  xml: (type) => ["tree", "xml", type],
};

export const useNodeTypes = () =>
  useQuery({ queryKey: treeKeys.nodeTypes, queryFn: async () => indexNodeTypes(await api.get(`${BASE}/getNodeTypes`)), staleTime: 60_000 });

export const useSubtreeList = () => useQuery({ queryKey: treeKeys.subtrees, queryFn: async () => ids(await api.get(`${BASE}/getSubtrees`)) });

/** { undo: label | null, redo: label | null } for the one-step undo. */
export const useUndoState = () =>
  useQuery({ queryKey: treeKeys.undo, queryFn: () => api.get(`${BASE}/undoState`), staleTime: 0, refetchOnWindowFocus: true });

// The DO/DI list is always re-parsed from do_di.xml: the IO page writes that
// file without updating the backend's parse cache, and "add as child" reads
// the cache, so a fresh parse keeps both in step.
export const useDoDiList = () =>
  useQuery({ queryKey: treeKeys.doDi, queryFn: async () => ids(await api.get(`${BASE}/getDoDiSubtrees?force_xml2js_parse=true`)) });

export const useSubtree = (id) =>
  useQuery({
    queryKey: treeKeys.subtree(id),
    queryFn: async () => convertSubtree(await api.get(`${BASE}/getSubtree/${encodeURIComponent(id)}`)),
    enabled: !!id,
    retry: 1,
    refetchOnWindowFocus: false,
  });

const previewUrl = { template: "getSubtree", doDi: "getDoDiSubtree" };
export const usePreviewSubtree = (kind, id) =>
  useQuery({
    queryKey: treeKeys.preview(kind, id),
    queryFn: async () => convertSubtree(await api.get(`${BASE}/${previewUrl[kind]}/${encodeURIComponent(id)}`)),
    enabled: !!id && !!kind,
    staleTime: 0,
  });

export const useTreeXml = (type, enabled) =>
  useQuery({
    queryKey: treeKeys.xml(type),
    queryFn: async () => (await api.post(`${BASE}/getTreeXML`, { treeType: type }))?.xml ?? "",
    enabled: !!type && enabled,
    staleTime: 0,
  });

/* ───────────── Mutations (plain functions; callers invalidate) ───────────── */
export const treeApi = {
  addSubtree: (name) => api.post(`${BASE}/addSubtree`, { name }),
  deleteSubtree: (subtreeId) => api.post(`${BASE}/deleteSubtree`, { subtreeId }),
  updateNode: (subtreeId, nodePath, newAttributes) => api.post(`${BASE}/updateNode`, { subtreeId, nodePath, newAttributes }),
  addNode: (subtreeId, parentPath, nodeType, nodeName, attributes) =>
    api.post(`${BASE}/addNode`, { subtreeId, parentPath, nodeType, nodeName, attributes }),
  addNodeAfter: (subtreeId, siblingPath, nodeType, nodeName, attributes) =>
    api.post(`${BASE}/addNodeAfter`, { subtreeId, siblingPath, nodeType, nodeName, attributes }),
  deleteNode: (subtreeId, nodePath) => api.post(`${BASE}/deleteNode`, { subtreeId, nodePath }),
  deleteWrapperOnly: (subtreeId, nodePath) => api.post(`${BASE}/deleteWrapperOnly`, { subtreeId, nodePath }),
  addWrapper: (subtreeId, nodePath, wrapperType) => api.post(`${BASE}/addWrapper`, { subtreeId, nodePath, wrapperType }),
  copyNode: (subtreeId, nodePath) => api.post(`${BASE}/copyNode`, { subtreeId, nodePath }),
  pasteNode: (subtreeId, targetPath, mode, fragment) => api.post(`${BASE}/pasteNode`, { subtreeId, targetPath, mode, fragment }),
  moveNodeAfter: (subtreeId, sourcePath, targetPath) => api.post(`${BASE}/moveNodeAfter`, { subtreeId, sourcePath, targetPath }),
  swapNodes: (subtreeId, nodePath1, nodePath2) => api.post(`${BASE}/swapNodes`, { subtreeId, nodePath1, nodePath2 }),
  addSubtreeAsChild: (kind, body) =>
    api.post(
      `${BASE}/${kind === "doDi" ? "addDoDiSubtreeAsChild" : "addSubtreeAsChild"}`,
      body
    ),
  addCustomNode: (body) => api.post(`${BASE}/addCustomNode`, body),
  undo: () => api.post(`${BASE}/undo`),
  redo: () => api.post(`${BASE}/redo`),
};
