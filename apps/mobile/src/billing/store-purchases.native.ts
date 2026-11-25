import { Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";
import { e2eMode } from "../config";
import { noStore, periodOf, type StorePurchases } from "./store";

/** Llave pública de Android de RevenueCat (`goog_…`). No es secreta: va en el APK. */
const KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";
/** Entitlement de RevenueCat que corresponde a premium. */
const ENTITLEMENT = "premium";

function create(): StorePurchases {
  let configured = false;
  let cache: PurchasesPackage[] = [];
  return {
    available: true,
    async connect(userId) {
      if (!configured) {
        Purchases.configure({ apiKey: KEY, appUserID: userId });
        configured = true;
      } else {
        await Purchases.logIn(userId);
      }
    },
    async packages() {
      const offerings = await Purchases.getOfferings();
      cache = offerings.current?.availablePackages ?? [];
      return cache.map((p) => ({
        id: p.identifier,
        priceText: p.product.priceString,
        period: periodOf(p.packageType),
      }));
    },
    async purchase(packageId) {
      const pkg = cache.find((p) => p.identifier === packageId);
      if (!pkg) return "failed";
      try {
        await Purchases.purchasePackage(pkg);
        return "purchased";
      } catch (error) {
        return (error as { userCancelled?: boolean }).userCancelled ? "cancelled" : "failed";
      }
    },
    async restore() {
      try {
        const info = await Purchases.restorePurchases();
        return info.entitlements.active[ENTITLEMENT] ? "restored" : "none";
      } catch {
        return "failed";
      }
    },
  };
}

export const storePurchases: StorePurchases =
  Platform.OS === "android" && KEY && !e2eMode ? create() : noStore;
