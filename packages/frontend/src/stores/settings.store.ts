import { create } from "zustand";
import { api } from "@/api/client";

interface SettingsState {
  settings: Record<string, string>;
  isLoading: boolean;
  fetchSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  isLoading: true,

  fetchSettings: async () => {
    try {
      const res = await api.getSettings();
      set({ settings: res.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
