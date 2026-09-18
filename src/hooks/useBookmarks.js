import { useCallback, useRef, useState } from 'react';
import {
  createBookmark,
  decideBookmarkCommunity,
  deleteBookmark,
  getBookmark,
  getOrgMembers,
  listBookmarks,
  renameBookmark,
  shareBookmark,
  submitBookmarkForCommunity,
} from '../api/filters';
import { useFilters } from '../context/FilterContext';
import { getBookmarkIdentity } from '../utils/bookmarkIdentity';

export function useBookmarks({ onApplied } = {}) {
  const { appliedFilters, setAppliedFilters } = useFilters();
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const detailCacheRef = useRef({});
  const orgMembersRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const identity = getBookmarkIdentity();
      const data = await listBookmarks(identity?.email);
      setBookmarks(data?.bookmarks || []);
    } catch (e) {
      setError(e.message || 'Failed to load bookmarks');
      setBookmarks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (name) => {
      if (!name?.trim()) throw new Error('Bookmark name is required');
      // NEW: every bookmark needs an owner — without one it'd save as
      // private with nobody able to see it again, including its own
      // creator. Callers should confirm an identity is set before
      // invoking save(); this throws a clear error if that got skipped.
      const identity = getBookmarkIdentity();
      if (!identity) throw new Error('Search and select your name before saving');
      const created = await createBookmark({
        name: name.trim(),
        filters: appliedFilters,
        owner: identity.email,
      });
      await refresh();
      return created;
    },
    [appliedFilters, refresh]
  );

  // NEW: the org directory doesn't change within a session, so this is
  // fetched once and reused by both the identity picker and the "share
  // with" checklist.
  //
  // BUGFIX: this used to cache ANY result — including an empty [] from a
  // failed fetch (e.g. the backend not having deployed /org-members yet,
  // or a transient network error). Since [] is truthy in JS, the
  // `if (orgMembersRef.current) return ...` guard then treated that
  // failure as "already loaded, nothing to do" forever — the identity
  // dropdown would stay empty for the rest of the session even once the
  // backend became reachable, with no way to retry short of a full page
  // reload. Now only a SUCCESSFUL fetch gets cached; a failure returns []
  // for that one call but leaves the cache empty so the next call (e.g.
  // reopening the Bookmarks panel) tries again.
  const getOrgMembersList = useCallback(async () => {
    if (orgMembersRef.current) return orgMembersRef.current;
    try {
      const data = await getOrgMembers();
      const members = data?.members || [];
      orgMembersRef.current = members;
      return members;
    } catch (e) {
      console.error('[bookmarks] failed to load org members:', e);
      return [];
    }
  }, []);

  // NEW: set a bookmark's visibility ("public" | "private") and, for
  // private, who it's shared with. Updates the in-memory list in place
  // rather than a full refresh() — the viewer's own list membership can't
  // change from their own share action (you always retain access to
  // bookmarks you own).
  const share = useCallback(async (id, visibility, sharedWith) => {
    const result = await shareBookmark(id, visibility, sharedWith);
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, visibility: result.visibility, sharedWith: result.sharedWith } : b))
    );
    return result;
  }, []);

  // NEW: community approval workflow. submitForCommunity is called by a
  // bookmark's owner; decideCommunity is called by a dashboard owner
  // (both checks are enforced server-side in lambda_handler.py — these
  // are just the calls, not the gate).
  const submitForCommunity = useCallback(async (id) => {
    const identity = getBookmarkIdentity();
    if (!identity) throw new Error('Search and select your name before submitting');
    const result = await submitBookmarkForCommunity(id, identity.email);
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, communityStatus: result.communityStatus } : b))
    );
    return result;
  }, []);

  const decideCommunity = useCallback(async (id, decision) => {
    const identity = getBookmarkIdentity();
    if (!identity) throw new Error('Search and select your name first');
    const result = await decideBookmarkCommunity(id, decision, identity.email);
    // An approval/rejection changes which GROUP this bookmark belongs in
    // (it leaves "Pending approval" either way), so a full refresh is
    // simpler and safer here than patching fields in place.
    await refresh();
    return result;
  }, [refresh]);

  const getFilters = useCallback(async (id) => {
    if (detailCacheRef.current[id]) return detailCacheRef.current[id];
    const record = await getBookmark(id);
    const filters = record?.filters || {};
    detailCacheRef.current[id] = filters;
    return filters;
  }, []);

  const open = useCallback(
    async (id) => {
      const record = await getBookmark(id);
      const filters = record?.filters || {};
      detailCacheRef.current[id] = filters;
      setAppliedFilters(filters);
      onApplied?.(
        Object.fromEntries(
          Object.entries(filters)
            .filter(([, f]) => f?.values?.length)
            .map(([col, f]) => [col, f.values])
        )
      );
      return record;
    },
    [setAppliedFilters, onApplied]
  );

  const rename = useCallback(
    async (id, name) => {
      await renameBookmark(id, name);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id) => {
      await deleteBookmark(id);
      delete detailCacheRef.current[id];
      await refresh();
    },
    [refresh]
  );

  return {
    bookmarks,
    loading,
    error,
    refresh,
    save,
    open,
    rename,
    remove,
    getFilters,
    share,
    getOrgMembersList,
    submitForCommunity,
    decideCommunity,
  };
}
