import { create } from "zustand";

interface UpgradeState {
  isOpen: boolean;
  message: string;
  show: (message: string) => void;
  hide: () => void;
}

export const useUpgradeStore = create<UpgradeState>((set) => ({
  isOpen: false,
  message: "",
  show: (message: string) => set({ isOpen: true, message }),
  hide: () => set({ isOpen: false, message: "" }),
}));
