/**
 * A page to go to after signing in (e.g. a leave-out approval link opened before signing in).
 * Only paths that match AFTER_SIGN_IN_PATH are followed, so the cookie can't send anyone off-site.
 */
export const AFTER_SIGN_IN_COOKIE = "kiota_after_sign_in";
export const AFTER_SIGN_IN_PATH = /^\/a\/[A-Za-z0-9_-]{20,40}$/;
