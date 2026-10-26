// Pages share a little of their live state with the tutorials (which node is
// selected, which subtree is open …) and a few actions (open a subtree,
// select a node). Only pages that have lessons publish here.
import { useEffect } from "react";
import { create } from "zustand";

export const useTutorialBridge = create(() => ({}));

/** Publish `value` under `name` while the page is mounted. */
export function useBridge(name, value) {
  useEffect(() => {
    useTutorialBridge.setState({ [name]: value });
  });
  useEffect(() => () => useTutorialBridge.setState({ [name]: null }), [name]);
}

export const bridge = (name) => useTutorialBridge.getState()[name] || null;
