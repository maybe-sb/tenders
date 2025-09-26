import { create } from "zustand";

interface DragState {
  activeResponseItemId?: string;
  targetIttItemId?: string;
}

interface MatchStore {
  dragState: DragState;
  setDragState: (state: DragState) => void;
  reset: () => void;
}

export const useMatchStore = create<MatchStore>((set) => ({
  dragState: {},
  setDragState: (dragState) => set({ dragState }),
  reset: () => set({ dragState: {} }),
}));
