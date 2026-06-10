import { create } from "zustand";
import { api, setAuthToken, setOnUnauthorized } from "@/api/client";

interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  /** RBAC role ("Owner" | "Admin" | …); null/undefined on legacy rows. */
  role?: string | null;
  permissions?: { resource: string; action: string }[];
  /** Present when the current session was minted via the ops impersonation flow. */
  impersonation?: { impersonator_id: string; reason: string | null } | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => {
  // Register the 401 callback so any API call that gets 401 clears auth state
  setOnUnauthorized(() => {
    setAuthToken(null);
    set({ user: null, token: null, isLoading: false });
  });

  return {
    user: null,
    token: null,
    isLoading: true,

    login: async (username: string, password: string) => {
      const res = await api.login(username, password);
      const { token, user } = res.data;
      setAuthToken(token);
      set({ user, token, isLoading: false });
    },

    logout: async () => {
      try {
        await api.logout();
      } catch {}
      setAuthToken(null);
      set({ user: null, token: null, isLoading: false });
    },

    checkAuth: async () => {
      // Handle OAuth callback: backend redirects to /?token=xxx
      const params = new URLSearchParams(window.location.search);
      const oauthToken = params.get("token");
      if (oauthToken) {
        setAuthToken(oauthToken);
        set({ token: oauthToken });
        // Clean URL without reload
        window.history.replaceState({}, "", window.location.pathname);
      }

      try {
        const res = await api.getMe();
        set({ user: res.data, isLoading: false });
      } catch {
        set({ user: null, token: null, isLoading: false });
      }
    },
  };
});
