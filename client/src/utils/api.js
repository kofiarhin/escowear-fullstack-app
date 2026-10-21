// Thin fetch wrapper. Network failures reject with `NetworkError` so callers can
// tell "server said no" apart from "we don't know what happened".
export class NetworkError extends Error {}

export const authHeader = (user) => (user?.token ? { Authorization: `Bearer ${user.token}` } : {});

export const apiRequest = async (path, { method = "GET", body, headers = {} } = {}) => {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError(error?.message || "Network request failed");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
};
