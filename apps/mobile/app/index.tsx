import { Redirect } from "expo-router";
import { useSession } from "../src/auth/session";
import { Loading } from "../src/components/ui";

export default function Index() {
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  return <Redirect href={state.status === "signedIn" ? "/(tabs)" : "/(auth)/sign-in"} />;
}
