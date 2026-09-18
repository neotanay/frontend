import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBookmarks } from '../hooks/useBookmarks';
import { useFilters } from '../context/FilterContext';
import { bookmarkUrlFor } from '../utils/bookmarkUrl';
import { getBookmarkIdentity, setBookmarkIdentity } from '../utils/bookmarkIdentity';

const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  link: 'M9 17H7a5 5 0 1 1 0-10h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.3-4.3',
  chevron: 'm6 9 6 6 6-6',
  bookmark: 'M6 3a1 1 0 0 0-1 1v17l7-4 7 4V4a1 1 0 0 0-1-1H6Z',
  external: 'M14 4h6m0 0v6m0-6L10 14M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m-9 0 1 14a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-14',
  check: 'M20 6 9 17l-5-5',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
};

function Icon({ name, size = 16, className }) {
  if (name === 'more') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
        <circle cx="12" cy="5" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function fmtBmDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-GB', { month: 'short' });
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${d.getFullYear()}, ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

// Same page size the old flat list used (10 per page) — restored here
// per-group instead of globally now that the list is split into sections.
const BOOKMARKS_GROUP_PAGE_SIZE = 10;

function isPublicBookmark(b) {
  // Bookmarks saved before this feature existed have no visibility field
  // at all — matches the backend's own default (see get_bookmarks in
  // lambda_handler.py) so nothing that used to be visible to everyone
  // silently disappears.
  return b.visibility === 'public' || !b.visibility;
}

// CHANGED: a bookmark can now be public two different ways — anyone can
// make their own bookmark public (still just "PUBLIC"), or the dashboard
// owner can approve a submitted one, which is a distinct, validated
// "✓ COMMUNITY" state (see communityStatus in lambda_handler.py). A
// pending/rejected submission shows its own badge regardless of the
// underlying visibility, since that's the more relevant status to surface
// while a review is outstanding.
function VisibilityBadge({ bookmark }) {
  if (bookmark.communityStatus === 'approved') {
    return <span className="bm-badge bm-badge-community">✓ COMMUNITY</span>;
  }
  if (bookmark.communityStatus === 'pending') {
    return <span className="bm-badge bm-badge-pending">PENDING REVIEW</span>;
  }
  if (bookmark.communityStatus === 'rejected') {
    return <span className="bm-badge bm-badge-rejected">REJECTED</span>;
  }
  return isPublicBookmark(bookmark) ? (
    <span className="bm-badge bm-badge-public">PUBLIC</span>
  ) : (
    <span className="bm-badge bm-badge-shared">SHARED</span>
  );
}

// "You are" identity search — shared between the list panel and the Save
// modal. Self-declared (there's no real login), stored via
// setBookmarkIdentity() in localStorage — see bookmarkIdentity.js for the
// SSO swap-point notes.
function IdentityPicker({ identity, onSelect, orgMembers }) {
  const [query, setQuery] = useState(identity?.name || '');
  const [showOptions, setShowOptions] = useState(false);
  const blurTimerRef = useRef(null);

  useEffect(() => {
    setQuery(identity?.name || '');
  }, [identity]);

  const matches = query.trim()
    ? orgMembers.filter(
        (m) =>
          m.name.toLowerCase().includes(query.trim().toLowerCase()) ||
          m.email.toLowerCase().includes(query.trim().toLowerCase())
      )
    : orgMembers;

  return (
    <div className="bm-identity-wrap">
      <label className="bm-label" htmlFor="bm-identity-input">
        You are
      </label>
      <input
        id="bm-identity-input"
        type="text"
        className="bm-input"
        placeholder="Search your name..."
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowOptions(true);
        }}
        onFocus={() => setShowOptions(true)}
        onBlur={() => {
          blurTimerRef.current = setTimeout(() => setShowOptions(false), 150);
        }}
      />
      {showOptions && matches.length > 0 && (
        <div className="bm-identity-options">
          {matches.slice(0, 8).map((m) => (
            <div
              key={m.email}
              className="bm-identity-option"
              onMouseDown={(e) => {
                e.preventDefault();
                clearTimeout(blurTimerRef.current);
                onSelect(m);
                setShowOptions(false);
              }}
            >
              {m.name} <span className="bm-identity-option-email">({m.email})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizeValues(values, max = 2) {
  if (!values?.length) return '';
  const shown = values.slice(0, max).join(', ');
  return values.length > max ? `${shown} +${values.length - max}` : shown;
}

async function buildBookmarkPdf(bmName, createdAt, url, filters) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 48;
  const pageBottom = 780;
  const pageWidth = 545;
  let y = 60;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(24, 24, 24);
  doc.text(bmName || 'Untitled bookmark', marginX, y);
  y += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text(`Saved: ${createdAt ? new Date(createdAt).toLocaleString() : ''}`, marginX, y);
  y += 24;

  doc.setTextColor(0, 135, 122);
  doc.textWithLink('Open this dashboard with these filters applied →', marginX, y, { url });
  y += 30;

  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, y, pageWidth, y);
  y += 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(24, 24, 24);
  doc.text('Filters', marginX, y);
  y += 20;

  doc.setFontSize(11);
  const rows = Object.entries(filters || {}).filter(([, f]) => f?.values?.length);
  if (!rows.length) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(136, 136, 136);
    doc.text('No filter details available.', marginX, y);
  } else {
    rows.forEach(([label, { values }]) => {
      const wrapped = doc.splitTextToSize(values.join(', '), pageWidth - marginX - 140);
      const rowHeight = 15 * Math.max(1, wrapped.length) + 8;
      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = 60;
      }
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(24, 24, 24);
      doc.text(`${label}:`, marginX, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(wrapped, marginX + 130, y);
      y += rowHeight;
    });
  }

  const safeName = (bmName || 'bookmark').replace(/[^\w\- ]+/g, '_').trim() || 'bookmark';
  doc.save(`${safeName}.pdf`);
}

export default function BookmarksPanel({ open, onClose, onApplied, showToast }) {
  const { appliedFilters } = useFilters();
  const {
    bookmarks,
    loading,
    error,
    refresh,
    save,
    open: openBookmark,
    rename,
    remove,
    getFilters,
    share,
    getOrgMembersList,
    submitForCommunity,
    decideCommunity,
  } = useBookmarks({ onApplied });

  const [view, setView] = useState('list');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [detailById, setDetailById] = useState({});
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openLinkId, setOpenLinkId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const renameInputRef = useRef(null);
  const skipNextRenameBlurRef = useRef(false);

  // NEW: identity + sharing state.
  const [identity, setIdentityState] = useState(getBookmarkIdentity());
  const [orgMembers, setOrgMembers] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState({ public: false, community: false, mine: false, pending: false });
  // NEW: restores the pagination the flat list used to have (10 per page,
  // Prev/Next), scoped per group now that the list is split into sections
  // — a flat single page count no longer makes sense once "Public
  // bookmarks" and "My bookmarks" can each have a different number of
  // items. Same page size as before (BOOKMARKS_GROUP_PAGE_SIZE = 10).
  const [groupPage, setGroupPage] = useState({});
  const [shareTarget, setShareTarget] = useState(null); // bookmark being shared, or null
  const [shareVisibility, setShareVisibility] = useState('private');
  const [shareSelected, setShareSelected] = useState(new Set());

  const handleIdentitySelect = (member) => {
    setBookmarkIdentity(member);
    setIdentityState(member);
    refresh();
  };

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    getOrgMembersList().then((members) => {
      setOrgMembers(members);
      // NEW: a previously-picked identity is stored as a plain object in
      // localStorage, which can go stale — e.g. it was saved before the
      // backend had an `isOwner` field at all, or a person's owner status
      // changed since. Re-sync it against the freshly loaded, authoritative
      // list rather than requiring the person to manually re-search their
      // own name just to pick up a field that changed server-side.
      const current = getBookmarkIdentity();
      if (current?.email && members.length) {
        const latest = members.find((m) => m.email.toLowerCase() === current.email.toLowerCase());
        if (latest && JSON.stringify(latest) !== JSON.stringify(current)) {
          setBookmarkIdentity(latest);
          setIdentityState(latest);
        }
      }
    });
    setView('list');
    setSaveResult(null);
    setName('');
    setQuery('');
  }, [open, refresh, getOrgMembersList]);

  // Restores the old behavior of resetting to page 1 whenever the search
  // narrows/widens the list or the underlying bookmark set changes —
  // otherwise a group could get stuck showing an empty "page 3" after a
  // search filters it down to one page.
  useEffect(() => {
    setGroupPage({});
  }, [query, bookmarks.length]);

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = () => setOpenMenuId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openMenuId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (view === 'save') {
        goToList();
      } else {
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, view]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  if (!open) return null;

  const appliedEntries = Object.entries(appliedFilters).filter(([, f]) => f?.values?.length);
  const filteredBookmarks = query.trim()
    ? bookmarks.filter((b) => (b.name || '').toLowerCase().includes(query.trim().toLowerCase()))
    : bookmarks;

  // CHANGED: restructured into named, collapsible groups instead of one
  // flat, numbered-paginated list. Groups are NOT mutually exclusive: a
  // bookmark you own AND made public appears in both "My bookmarks" and
  // "Public bookmarks" — different ways of browsing the same set, not
  // separate buckets.
  //   • Public bookmarks    → visibility is "public" (or missing, for
  //                          bookmarks saved before this feature existed).
  //                          A "✓ Community" badge additionally marks the
  //                          subset the dashboard owner has approved.
  //   • Shared with me      → visibility is "private" AND it's NOT yours
  //                          (it reached you only because you're in its
  //                          sharedWith list — the backend already only
  //                          sent it to you for that reason). RENAMED from
  //                          "Community bookmarks" now that "Community"
  //                          means something more specific (below).
  //   • My bookmarks        → owner is you, regardless of visibility
  //   • Pending approval    → NEW, owner-only: bookmarks anyone has
  //                          submitted for community review, regardless
  //                          of who owns them or their own visibility —
  //                          the backend only ever includes these for a
  //                          viewer who's actually a dashboard owner (see
  //                          get_bookmarks in lambda_handler.py), so this
  //                          group is simply empty for everyone else.
  const myEmail = identity?.email?.toLowerCase() || '';
  const isOwner = Boolean(identity?.isOwner);
  const bookmarkGroups = [
    { key: 'public', title: 'Public bookmarks', items: filteredBookmarks.filter(isPublicBookmark) },
    {
      key: 'community',
      title: 'Shared with me',
      items: filteredBookmarks.filter((b) => !isPublicBookmark(b) && b.owner?.toLowerCase() !== myEmail),
    },
    {
      key: 'mine',
      title: 'My bookmarks',
      items: filteredBookmarks.filter((b) => myEmail && b.owner?.toLowerCase() === myEmail),
    },
    ...(isOwner
      ? [
          {
            key: 'pending',
            title: 'Pending approval',
            items: filteredBookmarks.filter((b) => b.communityStatus === 'pending'),
          },
        ]
      : []),
  ];

  const guard = async (fn, { success, error } = {}) => {
    setBusy(true);
    try {
      await fn();
      if (success) showToast(success, 'success');
    } catch (e) {
      console.error('[bookmarks] action failed:', e);
      if (error) showToast(error, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleDetail = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!detailById[id]) {
      try {
        const filters = await getFilters(id);
        setDetailById((prev) => ({ ...prev, [id]: filters }));
      } catch (e) {
        console.error('[bookmarks] failed to load detail:', e);
      }
    }
  };

  const copyLink = async (id) => {
    const url = bookmarkUrlFor(id);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard', 'success');
    } catch (e) {
      console.error('[bookmarks] clipboard write failed:', e);
      showToast('Failed to copy link', 'error');
    }
  };

  // NEW: plain-text summary of a bookmark's filter selections, for the
  // "Copy selections" button in the expanded detail view.
  const copySelections = async (detailRows) => {
    const text = detailRows.map(([label, f]) => `${label}: ${f.values.join(', ')}`).join('; ');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Selections copied', 'success');
    } catch (e) {
      console.error('[bookmarks] clipboard write failed:', e);
      showToast('Failed to copy selections', 'error');
    }
  };

  // NEW: Share modal — Public vs Community. Reuses the same createPortal
  // pattern as the Save modal below. doShareSave() persists via
  // share() (POST /bookmark/share) — see post_bookmark_share in
  // lambda_handler.py for exactly what this does and does not restrict
  // (it only affects the LIST; the plain "🔗" link keeps working for
  // anyone who already has it, exactly as before).
  const openShareModal = (bookmark) => {
    setShareTarget(bookmark);
    setShareVisibility(isPublicBookmark(bookmark) ? 'public' : 'private');
    setShareSelected(new Set((bookmark.sharedWith || []).map((e) => e.toLowerCase())));
  };

  const closeShareModal = () => setShareTarget(null);

  const toggleShareMember = (email) => {
    setShareSelected((prev) => {
      const next = new Set(prev);
      const key = email.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const doShareSave = async () => {
    if (!shareTarget) return;
    setBusy(true);
    try {
      await share(
        shareTarget.id,
        shareVisibility,
        shareVisibility === 'private' ? Array.from(shareSelected) : []
      );
      showToast('Sharing updated', 'success');
      closeShareModal();
    } catch (e) {
      console.error('[bookmarks] share save failed:', e);
      showToast('Failed to update sharing', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveLocally = async (id, bmName, createdAt) => {
    await guard(async () => {
      const filters = await getFilters(id);
      await buildBookmarkPdf(bmName, createdAt, bookmarkUrlFor(id), filters);
    });
  };

  const goToList = () => {
    setView('list');
    setName('');
    setSaveResult(null);
  };

  const goToSave = () => {
    setView('save');
    setSaveResult(null);
  };

  const doSave = async () => {
    if (!name.trim() || !appliedEntries.length) return;
    // NEW: every bookmark needs an owner — save() already throws a clear
    // error if identity is missing, this just avoids the round-trip.
    if (!identity) {
      showToast('Search and select your name above before saving', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await save(name);
      setSaveResult({ id: created.id, name: created.name, url: bookmarkUrlFor(created.id) });
      showToast(`Bookmark "${created.name}" saved`, 'success');
    } catch (e) {
      console.error('[bookmarks] save failed:', e);
      showToast('Failed to save bookmark', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleMenu = (e, id) => {
    e.stopPropagation();
    setOpenMenuId((cur) => (cur === id ? null : id));
  };

  const toggleLinkBox = (e, id) => {
    e.stopPropagation();
    setOpenLinkId((cur) => (cur === id ? null : id));
  };

  const doOpen = (id, bmName) => {
    setOpenMenuId(null);
    guard(() => openBookmark(id), {
      success: `Applied filters from "${bmName || 'bookmark'}"`,
      error: 'Failed to apply bookmark filters',
    }).then(() => {
      setTimeout(onClose, 900);
    });
  };

  const startRename = (id, currentName) => {
    setOpenMenuId(null);
    setRenamingId(id);
    setRenameValue(currentName || '');
  };

  const commitRename = (id, originalName) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === originalName) return;
    guard(() => rename(id, trimmed), {
      success: `Bookmark renamed to "${trimmed}"`,
      error: 'Failed to rename bookmark',
    });
  };

  const doDelete = async (id, bmName) => {
    setOpenMenuId(null);
    setDeletingId(id);
    try {
      await guard(() => remove(id), {
        success: `Bookmark "${bmName || 'Untitled bookmark'}" deleted`,
        error: 'Failed to delete bookmark',
      });
    } finally {
      setDeletingId(null);
    }
  };

  // NEW: community approval workflow handlers.
  const doSubmitForCommunity = (id, bmName) => {
    guard(() => submitForCommunity(id), {
      success: `"${bmName || 'Bookmark'}" submitted for community review`,
      error: 'Failed to submit for community review',
    });
  };

  const doDecideCommunity = (id, decision, bmName) => {
    guard(() => decideCommunity(id, decision), {
      success:
        decision === 'approve'
          ? `"${bmName || 'Bookmark'}" approved and published as Community`
          : `"${bmName || 'Bookmark'}" rejected`,
      error: `Failed to ${decision} this submission`,
    });
  };

  return (
    <>
    <div className="bm-side-panel" role="dialog" aria-label="Bookmarks">
      <div className="bm-panel-header">
        <div className="bm-panel-title-row">
          <button
            className="bm-panel-back"
            onClick={view === 'save' ? goToList : onClose}
            aria-label="Back"
          >
            <Icon name="chevron" size={16} className="bm-back-chevron" />
          </button>
          <div>
            <div className="bm-panel-title">Bookmarks</div>
            <div className="bm-panel-subtitle">
              {bookmarks.length ? `${bookmarks.length} saved` : 'Saved filter sets'}
            </div>
          </div>
        </div>
        <button className="bm-panel-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="bm-panel-body">
        <div className="bm-panel-fixed">
          <button className="bm-add-btn" onClick={goToSave}>
            <Icon name="plus" size={16} /> Add bookmark
          </button>

          <IdentityPicker identity={identity} onSelect={handleIdentitySelect} orgMembers={orgMembers} />

          {bookmarks.length > 0 && view !== 'save' && (
            <div className="bm-search">
              <Icon name="search" size={14} className="bm-search-icon" />
              <input
                type="text"
                className="bm-search-input"
                placeholder="Search bookmarks…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="bm-panel-list">
            {loading && !bookmarks.length && (
              <div className="bm-skeleton-list" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div className="bm-skeleton-row" key={i}>
                    <div className="bm-skeleton-line bm-skeleton-line-title" />
                    <div className="bm-skeleton-line bm-skeleton-line-sub" />
                  </div>
                ))}
              </div>
            )}
            {error && (
              <div className="bm-empty-state bm-empty-state-inline">
                <Icon name="bookmark" size={22} className="bm-empty-icon" />
                <div className="bm-empty-sub">No saved bookmarks found.</div>
              </div>
            )}

            {!loading && !error && !bookmarks.length && (
              <div className="bm-empty-state">
                <Icon name="bookmark" size={28} className="bm-empty-icon" />
                <div className="bm-empty-title">No bookmarks yet</div>
                <div className="bm-empty-sub">
                  Apply some filters, then save them here to quickly come back to this view.
                </div>
              </div>
            )}
            {!loading && !error && bookmarks.length > 0 && !filteredBookmarks.length && (
              <div className="bm-empty-state">
                <div className="bm-empty-sub">No bookmarks match "{query}".</div>
              </div>
            )}

            {bookmarkGroups.map((group) => {
              const totalPages = Math.max(1, Math.ceil(group.items.length / BOOKMARKS_GROUP_PAGE_SIZE));
              const currentPage = Math.min(groupPage[group.key] || 1, totalPages);
              const pagedItems = group.items.slice(
                (currentPage - 1) * BOOKMARKS_GROUP_PAGE_SIZE,
                currentPage * BOOKMARKS_GROUP_PAGE_SIZE
              );
              return (
              <div className="bm-group" key={group.key}>
                <div className="bm-group-header" onClick={() => toggleGroup(group.key)}>
                  <Icon
                    name="chevron"
                    size={14}
                    className={`bm-group-chevron${collapsedGroups[group.key] ? ' collapsed' : ''}`}
                  />
                  <span className="bm-group-title">
                    {group.title} ({group.items.length})
                  </span>
                </div>
                {!collapsedGroups[group.key] &&
                  (group.items.length ? (
                    pagedItems.map((b) => {
              const isExpanded = expandedId === b.id;
              const isRenaming = renamingId === b.id;
              const isDeleting = deletingId === b.id;
              const detail = detailById[b.id];
              const detailRows = detail
                ? Object.entries(detail).filter(([, f]) => f?.values?.length)
                : [];
              return (
                <div className={`bm-row${isDeleting ? ' bm-row-deleting' : ''}`} key={b.id}>
                  <div className="bm-row-top">
                    <div
                      className="bm-row-main"
                      onClick={() => !isRenaming && !isDeleting && toggleDetail(b.id)}
                    >
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="bm-rename-input"
                          value={renameValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              skipNextRenameBlurRef.current = true;
                              commitRename(b.id, b.name);
                            }
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              skipNextRenameBlurRef.current = true;
                              setRenamingId(null);
                            }
                          }}
                          onBlur={() => {
                            if (skipNextRenameBlurRef.current) {
                              skipNextRenameBlurRef.current = false;
                              return;
                            }
                            commitRename(b.id, b.name);
                          }}
                        />
                      ) : (
                        <div className="bm-row-name-line">
                          <div className="bm-row-name">
                            {b.name || 'Untitled bookmark'}
                            <VisibilityBadge bookmark={b} />
                          </div>
                          <span className="bm-row-date-badge">{fmtBmDate(b.createdAt)}</span>
                        </div>
                      )}
                    </div>
                    <div className="bm-row-actions">
                      {isDeleting ? (
                        <span className="bm-row-deleting-indicator">
                          <span className="bm-row-spinner" aria-hidden="true" />
                          Deleting…
                        </span>
                      ) : isOwner && b.communityStatus === 'pending' ? (
                        // NEW: a dashboard owner reviewing a pending
                        // submission gets Approve/Reject directly on the
                        // row — these are the actions that actually matter
                        // here, so they're not buried in the "⋮" menu.
                        <>
                          <button
                            className="bm-icon-btn bm-approve-btn"
                            title="Approve and publish as Community"
                            disabled={busy}
                            onClick={() => doDecideCommunity(b.id, 'approve', b.name)}
                          >
                            <Icon name="check" size={15} />
                          </button>
                          <button
                            className="bm-icon-btn bm-reject-btn"
                            title="Reject"
                            disabled={busy}
                            onClick={() => doDecideCommunity(b.id, 'reject', b.name)}
                          >
                            <Icon name="x" size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="bm-icon-btn"
                            title="Show/copy link"
                            onClick={(e) => toggleLinkBox(e, b.id)}
                          >
                            <Icon name="link" size={15} />
                          </button>
                          <div className="bm-row-menu-wrap">
                            <button
                              className="bm-icon-btn"
                              title="More actions"
                              onClick={(e) => toggleMenu(e, b.id)}
                            >
                              <Icon name="more" size={16} />
                            </button>
                            <div className={`bm-dropdown${openMenuId === b.id ? ' open' : ''}`}>
                              <button disabled={busy} onClick={() => doOpen(b.id, b.name)}>
                                <Icon name="external" size={14} /> Open (apply filters)
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  saveLocally(b.id, b.name, b.createdAt);
                                }}
                              >
                                <Icon name="download" size={14} /> Save locally
                              </button>
                              <button disabled={busy} onClick={() => startRename(b.id, b.name)}>
                                <Icon name="pencil" size={14} /> Rename
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  openShareModal(b);
                                }}
                              >
                                <Icon name="share" size={14} /> Share
                              </button>
                              {/* NEW: only the bookmark's own owner can
                                  submit it, and only when it isn't already
                                  pending/approved — matches the server-side
                                  check in post_bookmark_community_submit. */}
                              {b.owner?.toLowerCase() === myEmail &&
                                (b.communityStatus === 'none' || !b.communityStatus || b.communityStatus === 'rejected') && (
                                  <button
                                    disabled={busy}
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      doSubmitForCommunity(b.id, b.name);
                                    }}
                                  >
                                    <Icon name="users" size={14} /> Submit for Community
                                  </button>
                                )}
                              <button
                                className="bm-danger"
                                disabled={busy}
                                onClick={() => doDelete(b.id, b.name)}
                              >
                                <Icon name="trash" size={14} /> Delete
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {openLinkId === b.id && (
                    <div className="bm-link-box">
                      <input
                        type="text"
                        className="bm-link-input"
                        value={bookmarkUrlFor(b.id)}
                        readOnly
                        onClick={(e) => e.target.select()}
                      />
                      <button className="bm-copy-btn" onClick={() => copyLink(b.id)}>
                        Copy
                      </button>
                    </div>
                  )}
                  {isExpanded && (
                    <div className="bm-detail">
                      {/* NEW: owner/visibility line, matching what the
                          backend now tracks for every bookmark. */}
                      <div className="bm-detail-row">
                        <span className="bm-fname">Owner</span>
                        <span className="bm-fvals">{b.owner || '—'}</span>
                      </div>
                      <div className="bm-detail-row">
                        <span className="bm-fname">Visibility</span>
                        <span className="bm-fvals">
                          {b.communityStatus === 'approved'
                            ? 'Public (Community-approved)'
                            : b.communityStatus === 'pending'
                            ? 'Private (pending community review)'
                            : b.communityStatus === 'rejected'
                            ? 'Private (community submission rejected)'
                            : isPublicBookmark(b)
                            ? 'Public'
                            : b.sharedWith?.length
                            ? `Shared with ${b.sharedWith.length}`
                            : 'Private'}
                        </span>
                      </div>
                      {!detail && <div className="bm-detail-loading">Loading filter details…</div>}
                      {detail && !detailRows.length && (
                        <div className="bm-empty">No filter details found.</div>
                      )}
                      {detailRows.map(([label, f]) => (
                        <div className="bm-detail-row" key={label}>
                          <span className="bm-fname">{label}</span>
                          <span className="bm-fvals">{f.values.join(', ')}</span>
                        </div>
                      ))}
                      {detailRows.length > 0 && (
                        <button
                          className="bm-copy-btn bm-copy-selections-btn"
                          onClick={() => copySelections(detailRows)}
                        >
                          Copy selections
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
                    })
                  ) : (
                    <div className="bm-empty" style={{ marginLeft: 14 }}>
                      {query ? 'No matches.' : 'None yet.'}
                    </div>
                  ))}
                {!collapsedGroups[group.key] && totalPages > 1 && (
                  <div className="bm-pagination">
                    <button
                      className="bm-pagination-btn"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setGroupPage((prev) => ({ ...prev, [group.key]: Math.max(1, currentPage - 1) }))
                      }
                    >
                      ‹ Prev
                    </button>
                    <span className="bm-pagination-info">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      className="bm-pagination-btn"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setGroupPage((prev) => ({ ...prev, [group.key]: Math.min(totalPages, currentPage + 1) }))
                      }
                    >
                      Next ›
                    </button>
                  </div>
                )}
              </div>
              );
            })}
            </div>
        </div>
      </div>
    {view === 'save' &&
      createPortal(
        <div className="bm-modal-backdrop" onClick={goToList}>
          <div
            className="bm-modal-card"
            role="dialog"
            aria-label="Add bookmark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bm-modal-header">
              <div className="bm-panel-title">Add bookmark</div>
              <button className="bm-panel-close" onClick={goToList} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>

            {!saveResult && (
              <>
                <IdentityPicker identity={identity} onSelect={handleIdentitySelect} orgMembers={orgMembers} />
                <label className="bm-label" htmlFor="bm-name-input">
                  Name
                </label>
                <input
                  id="bm-name-input"
                  className="bm-input"
                  placeholder=""
                  maxLength={120}
                  autoComplete="off"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim() && appliedEntries.length) {
                      doSave();
                    }
                  }}
                />
              </>
            )}
            <label className="bm-label">Filters being saved</label>
            {appliedEntries.length ? (
              <div className="bm-chip-list">
                {appliedEntries.map(([label, f]) => (
                  <span className="bm-chip" key={label}>
                    <span className="bm-chip-label">{label}</span>
                    <span className="bm-chip-value">{summarizeValues(f.values)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="bm-empty-state bm-empty-state-inline">
                <Icon name="bookmark" size={22} className="bm-empty-icon" />
                <div className="bm-empty-sub">Apply at least one filter to bookmark this view.</div>
              </div>
            )}
            <button
              className="bm-save-btn"
              disabled={busy || !name.trim() || !appliedEntries.length || Boolean(saveResult)}
              onClick={doSave}
            >
              {busy ? (
                <>
                  <span className="bm-btn-spinner" aria-hidden="true" /> Saving…
                </>
              ) : saveResult ? (
                <>
                  <Icon name="check" size={15} /> Saved
                </>
              ) : (
                'Save bookmark'
              )}
            </button>
            {saveResult && (
              <div className="bm-save-result">
                <label className="bm-label">Shareable link</label>
                <div className="bm-save-result-link-row">
                  <input
                    type="text"
                    className="bm-input"
                    value={saveResult.url}
                    readOnly
                    onClick={(e) => e.target.select()}
                  />
                  <button
                    className="bm-icon-btn"
                    title="Copy link"
                    onClick={() => copyLink(saveResult.id)}
                  >
                    <Icon name="link" size={15} />
                  </button>
                  <button
                    className="bm-icon-btn"
                    title="Save locally"
                    onClick={() => saveLocally(saveResult.id, saveResult.name)}
                  >
                    <Icon name="download" size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    {shareTarget &&
      createPortal(
        <div className="bm-modal-backdrop" onClick={closeShareModal}>
          <div
            className="bm-modal-card"
            role="dialog"
            aria-label="Share bookmark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bm-modal-header">
              <div className="bm-panel-title">{shareTarget.name || 'Bookmark'}</div>
              <button className="bm-panel-close" onClick={closeShareModal} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="bm-share-toggle-row">
              <button
                className={`bm-share-toggle-btn${shareVisibility === 'public' ? ' active' : ''}`}
                onClick={() => setShareVisibility('public')}
              >
                <Icon name="globe" size={15} /> Public
              </button>
              <button
                className={`bm-share-toggle-btn${shareVisibility === 'private' ? ' active' : ''}`}
                onClick={() => setShareVisibility('private')}
              >
                <Icon name="users" size={15} /> Community
              </button>
            </div>

            {shareVisibility === 'public' ? (
              <div className="bm-empty-state bm-empty-state-inline">
                <div className="bm-empty-sub">Visible to everyone in My Bookmarks.</div>
              </div>
            ) : (
              <>
                <label className="bm-label">Share with</label>
                <div className="bm-share-member-list">
                  {orgMembers.length ? (
                    orgMembers.map((m) => (
                      <label className="bm-share-member-row" key={m.email}>
                        <input
                          type="checkbox"
                          checked={shareSelected.has(m.email.toLowerCase())}
                          onChange={() => toggleShareMember(m.email)}
                        />
                        {m.name} <span className="bm-identity-option-email">({m.email})</span>
                      </label>
                    ))
                  ) : (
                    <div className="bm-empty-sub">No org members configured.</div>
                  )}
                </div>
              </>
            )}

            <button className="bm-save-btn" disabled={busy} onClick={doShareSave}>
              {busy ? (
                <>
                  <span className="bm-btn-spinner" aria-hidden="true" /> Saving…
                </>
              ) : (
                'Save sharing'
              )}
            </button>

            <div className="bm-save-result">
              <label className="bm-label">Link</label>
              <div className="bm-save-result-link-row">
                <input
                  type="text"
                  className="bm-input"
                  value={bookmarkUrlFor(shareTarget.id)}
                  readOnly
                  onClick={(e) => e.target.select()}
                />
                <button
                  className="bm-icon-btn"
                  title="Copy link"
                  onClick={() => copyLink(shareTarget.id)}
                >
                  <Icon name="link" size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

