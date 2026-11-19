import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type AuthClient, createAuthClient } from "../api/auth-client";
import { apiUrl } from "../config";
import { tokenStore } from "./token-store";

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly token: string };

interface Session {
  readonly state: SessionState;
  readonly client: AuthClient;
  signIn(token: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const client = useMemo(() => createAuthClient(apiUrl), []);
  const [state, setState] = useState<SessionState>({ status: "loading" });

  // Al abrir la app se valida el token guardado; si la API lo rechaza, se borra.
  // Sin conexión se conserva para no cerrar la sesión por un corte de red.
  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await tokenStore.read();
      if (!token) {
        if (active) setState({ status: "signedOut" });
        return;
      }
      const me = await client.me(token);
      if (me.ok && me.value === null) {
        await tokenStore.clear();
        if (active) setState({ status: "signedOut" });
        return;
      }
      if (active) setState({ status: "signedIn", token });
    })();
    return () => {
      active = false;
    };
  }, [client]);

  const signIn = useCallback(async (token: string) => {
    await tokenStore.write(token);
    setState({ status: "signedIn", token });
  }, []);

  const signOut = useCallback(async () => {
    if (state.status === "signedIn") await client.signOut(state.token);
    await tokenStore.clear();
    setState({ status: "signedOut" });
  }, [client, state]);

  const value = useMemo(
    () => ({ state, client, signIn, signOut }),
    [state, client, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = (): Session => {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession debe usarse dentro de <SessionProvider>");
  return session;
};
