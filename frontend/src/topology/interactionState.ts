export type CanvasInteractionMode = "selection" | "pan";

export interface CanvasInteractionState {
  mode: CanvasInteractionMode;
  spacePressed: boolean;
}

export type CanvasInteractionEvent =
  | { type: "spaceDown" }
  | { type: "spaceUp" }
  | { type: "forceSelection" };

export const MARQUEE_DRAG_THRESHOLD_PX = 5;

export const INITIAL_CANVAS_INTERACTION_STATE: CanvasInteractionState = {
  mode: "selection",
  spacePressed: false,
};

export function reduceCanvasInteractionState(
  state: CanvasInteractionState,
  event: CanvasInteractionEvent
): CanvasInteractionState {
  if (event.type === "spaceDown") {
    if (state.mode === "pan" && state.spacePressed) return state;
    return { mode: "pan", spacePressed: true };
  }
  if (state.mode === "selection" && !state.spacePressed) return state;
  return { mode: "selection", spacePressed: false };
}

export function canvasInteractionCapabilities(state: CanvasInteractionState): {
  userPanningEnabled: boolean;
  marqueeEnabled: boolean;
} {
  const userPanningEnabled = state.mode === "pan";
  return {
    userPanningEnabled,
    marqueeEnabled: !userPanningEnabled,
  };
}

export function isSpaceKey(event: Pick<KeyboardEvent, "code" | "key">): boolean {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

export function shouldIgnoreCanvasShortcut(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  return Boolean(el?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
}

export function isPrimaryMouseButton(button: number | undefined): boolean {
  return button == null || button === 0;
}

export function isMarqueeDrag(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = MARQUEE_DRAG_THRESHOLD_PX
): boolean {
  return Math.max(Math.abs(current.x - start.x), Math.abs(current.y - start.y)) >= threshold;
}

export function nodeClickSelectionMode(
  currentIds: readonly string[],
  nodeId: string,
  modifiers: { add?: boolean; toggle?: boolean } = {}
): "replace" | "add" | "toggle" {
  if (modifiers.toggle) return "toggle";
  if (modifiers.add) return "add";
  if (currentIds.includes(nodeId)) return "toggle";
  return currentIds.length ? "add" : "replace";
}
