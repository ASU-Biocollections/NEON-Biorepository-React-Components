const ANCHOR_GAP = 24;

// Nested header wrappers overlap; their heights must not be added together.
export const stickyBottom = (element) => {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const top = parseFloat(style.top);
  if (!rect.height || !rect.width || style.visibility === 'hidden'
      || !['sticky', 'fixed'].includes(style.position) || !Number.isFinite(top)) return 0;
  return Math.max(0, style.position === 'fixed'
    ? rect.bottom : Math.min(rect.bottom, top + rect.height));
};

export const getPageAnchorOffset = () => (
  parseFloat(window.getComputedStyle(document.documentElement)
    .getPropertyValue('--neon-anchor-offset')) || ANCHOR_GAP
);

export function observePageOffsets({ getHeader, getSidebar, getContent }) {
  const root = document.documentElement;
  const previous = ['--neon-header-offset', '--neon-anchor-offset'].map((name) => (
    [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]
  ));
  const previousLayout = root.getAttribute('data-neon-page-layout');
  root.setAttribute('data-neon-page-layout', '');
  let frame = null;
  let stopped = false;
  let observed = [];
  let sidebar = null;
  let previousInset = '';
  let followAnchor = Boolean(window.location.hash);
  let lastAlignment = null;

  const targetForHash = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); }
    catch { return null; }
    if (!id) return null;
    const target = document.getElementById(id) || document.getElementsByName(id)[0];
    return target && getContent()?.contains(target) && target.getClientRects().length
      ? target : null;
  };
  const setPixels = (element, name, value) => {
    const text = `${Math.ceil(value)}px`;
    if (element.style.getPropertyValue(name) !== text) element.style.setProperty(name, text);
  };
  const schedule = () => {
    if (!stopped && frame === null) frame = window.requestAnimationFrame(update);
  };
  const resizeObserver = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
  const update = () => {
    frame = null;
    const header = getHeader();
    const headers = [...new Set([
      header,
      ...document.querySelectorAll('#header, #main-header, .region-utility'),
      ...(header?.querySelectorAll('header, [role="banner"]') || []),
    ].filter(Boolean))];
    const nextSidebar = getSidebar();
    if (sidebar !== nextSidebar) {
      if (sidebar) sidebar.style.setProperty('--neon-sidebar-inset', previousInset);
      sidebar = nextSidebar;
      previousInset = sidebar?.style.getPropertyValue('--neon-sidebar-inset') || '';
    }
    const target = followAnchor ? targetForHash() : null;
    const elements = [...new Set([...headers, sidebar, getContent(), target].filter(Boolean))];
    if (elements.length !== observed.length || elements.some((element, i) => element !== observed[i])) {
      resizeObserver?.disconnect();
      elements.forEach((element) => resizeObserver?.observe(element));
      observed = elements;
    }
    const headerOffset = Math.ceil(Math.max(0, ...headers.map(stickyBottom)));
    setPixels(root, '--neon-header-offset', headerOffset);
    if (sidebar) {
      setPixels(sidebar, '--neon-sidebar-inset', parseFloat(window.getComputedStyle(sidebar).paddingTop) || 0);
    }
    // Only the full-width mobile sidebar covers content. Desktop sidebars sit alongside it.
    const sidebarOffset = sidebar && stickyBottom(sidebar)
      ? sidebar.getBoundingClientRect().height : 0;
    const anchorOffset = Math.ceil(headerOffset + sidebarOffset + ANCHOR_GAP);
    setPixels(root, '--neon-anchor-offset', anchorOffset);
    if (!target) return;
    const targetTop = window.scrollY + target.getBoundingClientRect().top;
    if (!lastAlignment || lastAlignment.target !== target
        || Math.abs(lastAlignment.targetTop - targetTop) > 1
        || lastAlignment.offset !== anchorOffset) {
      window.scrollTo({ top: Math.max(0, targetTop - anchorOffset), behavior: 'instant' });
      lastAlignment = { target, targetTop, offset: anchorOffset, scrollY: window.scrollY };
    }
  };
  const requestAnchor = () => {
    followAnchor = Boolean(window.location.hash);
    lastAlignment = null;
    schedule();
  };
  const stopFollowing = () => { followAnchor = false; lastAlignment = null; };
  const onScroll = () => {
    // Do not pull a reader back to an old hash after they scroll away from it.
    if (lastAlignment && Math.abs(window.scrollY - lastAlignment.scrollY) > 2
        && Math.abs(lastAlignment.target.getBoundingClientRect().top - lastAlignment.offset) > 2) {
      stopFollowing();
    }
    schedule();
  };
  const onKeyDown = (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopFollowing();
  };
  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
        || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname
        || url.search !== window.location.search || !url.hash) return;
    // Let native navigation preserve history and focus, including repeated clicks on the same hash.
    followAnchor = true;
    lastAlignment = null;
    schedule();
  };
  const mutationObserver = new window.MutationObserver(schedule);
  mutationObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'],
  });
  mutationObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  window.addEventListener('hashchange', requestAnchor);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  window.addEventListener('biorepo:neon-page-ready', schedule);
  window.addEventListener('wheel', stopFollowing, { passive: true });
  window.addEventListener('touchmove', stopFollowing, { passive: true });
  window.addEventListener('pointerdown', stopFollowing, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onClick);
  document.addEventListener('load', schedule, true);
  document.fonts?.addEventListener('loadingdone', schedule);
  document.fonts?.ready.then(schedule);
  update();

  return () => {
    stopped = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener('hashchange', requestAnchor);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('load', schedule);
    window.removeEventListener('biorepo:neon-page-ready', schedule);
    window.removeEventListener('wheel', stopFollowing);
    window.removeEventListener('touchmove', stopFollowing);
    window.removeEventListener('pointerdown', stopFollowing);
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onClick);
    document.removeEventListener('load', schedule, true);
    document.fonts?.removeEventListener('loadingdone', schedule);
    if (sidebar) sidebar.style.setProperty('--neon-sidebar-inset', previousInset);
    previous.forEach(([name, value, priority]) => root.style.setProperty(name, value, priority));
    if (previousLayout === null) root.removeAttribute('data-neon-page-layout');
    else root.setAttribute('data-neon-page-layout', previousLayout);
  };
}
