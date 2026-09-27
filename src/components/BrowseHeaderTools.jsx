import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

// Tab pages stay mounted. Only the active list may contribute header controls.
export default function BrowseHeaderTools({ path, children }) {
  const { pathname } = useLocation();
  const [host, setHost] = useState(null);

  useLayoutEffect(() => {
    setHost(document.getElementById('pg-browse-header-tools'));
  }, [pathname]);

  return pathname === path && host ? createPortal(children, host) : null;
}
