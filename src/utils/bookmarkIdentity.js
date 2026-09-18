// "Who am I" identity — powers the sharing feature the backend already
// supports (owner/visibility/sharedWith on every bookmark, and GET
// /bookmarks filters by a ?viewer= param). There's no real login yet, so
// identity is self-declared: whoever searches and picks their own name in
// the Bookmarks panel. Every bookmark-related call goes through
// getBookmarkIdentity() — nothing else touches localStorage directly — so
// this is the ONE function to change when SSO arrives:
//
//   export function getBookmarkIdentity() {
//     const u = YourSsoLibrary.getCurrentUser();
//     return u ? { name: u.displayName, email: u.email } : null;
//   }
//
// Everything downstream (owner, sharedWith, viewer filtering, the
// Public/Community/My-bookmarks grouping) already keys off identity.email
// exactly the way it would with a real login.

const IDENTITY_KEY = 'bm_identity';

export function getBookmarkIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setBookmarkIdentity(member) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(member));
}
