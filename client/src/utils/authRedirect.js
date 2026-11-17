// Where to send someone after they sign in or register. A return path is only
// honoured when it is a same-site path ("/checkout"), never a protocol-relative
// or absolute URL, so a crafted link cannot bounce people to another site.
const RETURN_PARAMS = ["redirect", "return-to", "returnTo"];

export const safeReturnPath = (value) => {
  if (typeof value !== "string") return null;
  let path;
  try {
    path = decodeURIComponent(value).trim();
  } catch {
    return null;
  }
  // Backslashes and control characters are rejected because browsers treat
  // "/\evil.com" like "//evil.com".
  if (!/^\/(?!\/)/.test(path) || /[\\\u0000-\u001f]/.test(path)) return null;
  return path;
};

export const defaultLandingPath = (user) => (user?.role === "admin" ? "/admin" : "/account");

// `from` is location.state.from; `search` is location.search.
export const postLoginPath = (user, { from, search } = {}) => {
  const fromState = safeReturnPath(from);
  if (fromState) return fromState;
  const params = new URLSearchParams(search || "");
  for (const name of RETURN_PARAMS) {
    const candidate = params.get(name);
    // URLSearchParams has already decoded once; safeReturnPath decodes again
    // so double-encoded values such as "%2F%2Fevil.com" are still caught.
    const path = candidate === null ? null : safeReturnPath(candidate);
    if (path) return path;
  }
  return defaultLandingPath(user);
};
