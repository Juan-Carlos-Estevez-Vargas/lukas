import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/auth/session";
import { Loading } from "../../src/components/ui";
import { useOnboarding } from "../../src/onboarding/use-onboarding";

export default function OnboardingLayout() {
  const { state } = useSession();
  const { status } = useOnboarding();
  if (state.status === "loading" || status === "checking") return <Loading />;
  if (state.status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  if (status !== "pending") return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
