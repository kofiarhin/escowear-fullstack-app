import { apiRequest } from "./api";

// Whether the shop is accepting new order requests. Resolves to null when
// unknown (network/server problem): the form then stays usable, because the
// server enforces the switch and explains a closed checkout on submit.
export const fetchCheckoutStatus = async () => {
  try {
    const { ok, data } = await apiRequest("/api/orders/checkout-status");
    return ok && typeof data?.open === "boolean" ? data.open : null;
  } catch {
    return null;
  }
};
