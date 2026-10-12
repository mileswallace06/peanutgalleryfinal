// Upgrades navigation tests use a guest fixture; participant reads stay disabled.
export function useAuth() { return { user: null, isAuthenticated: false, isLoadingAuth: false }; }
