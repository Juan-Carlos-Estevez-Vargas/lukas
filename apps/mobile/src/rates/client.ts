import { apiUrl } from "../config";
import { createRatesClient } from "./rates";

/** Cliente de tasas contra la API del entorno. */
export const ratesClient = createRatesClient(apiUrl);
