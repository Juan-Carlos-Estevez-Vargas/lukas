import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/auth/session";

export default function AuthLayout() {
  const { state } = useSession();
  if (state.status === "signedIn") return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
