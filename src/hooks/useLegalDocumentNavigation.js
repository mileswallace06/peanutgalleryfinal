import { useEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { findLegalFragment, scrollLegalFragment } from '@/lib/legalDocument';

const positions = new Map();

/** Route fragment restoration belongs to the public page's actual scroller. */
export function useLegalDocumentNavigation(scrollerRef) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const key = `${location.pathname}:${location.key}`;
    let disposed = false;
    let restored = false;
    let frame;
    const restore = () => {
      if (disposed || restored) return;
      if (location.hash) {
        const target = findLegalFragment(scroller, location.hash);
        if (target) restored = scrollLegalFragment(scroller, target);
      } else {
        scroller.scrollTo({ top: navigationType === 'POP' ? positions.get(key) || 0 : 0, behavior: 'instant' });
        restored = true;
      }
    };
    const scheduleRestore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(restore); });
    };
    const observer = new MutationObserver(scheduleRestore);
    observer.observe(scroller, { childList: true, subtree: true });
    const updateOffset = () => {
      const height = scroller.querySelector('.pg-public-header')?.getBoundingClientRect().height || 0;
      scroller.style.setProperty('--pg-public-scroll-offset', `${height + 16}px`);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOffset);
    const header = scroller.querySelector('.pg-public-header');
    if (header) resize?.observe(header);
    updateOffset();
    scheduleRestore();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize?.disconnect();
      positions.set(key, scroller.scrollTop);
      if (positions.size > 100) positions.delete(positions.keys().next().value);
    };
  }, [location.pathname, location.key, location.hash, navigationType, scrollerRef]);

  return event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.getAttribute('href'), new URL(`${location.pathname}${location.search}`, window.location.origin));
    if (url.origin !== window.location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
    event.preventDefault();
    if (url.hash === location.hash) {
      scrollLegalFragment(scrollerRef.current, findLegalFragment(scrollerRef.current, url.hash));
    } else {
      navigate({ pathname: location.pathname, search: location.search, hash: url.hash });
    }
  };
}
