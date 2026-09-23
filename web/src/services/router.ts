import { useEffect, useState } from 'react';

export type Route = { page: 'projects' } | { page: 'canvas'; projectId: string };

export function parseRoute(pathname: string): Route {
  const m = /^\/p\/([^/]+)\/?$/.exec(pathname);
  return m ? { page: 'canvas', projectId: decodeURIComponent(m[1]) } : { page: 'projects' };
}

export const projectHref = (id: string) => `/p/${encodeURIComponent(id)}`;

/** Client-side navigation; the Go server falls back to index.html for these paths. */
export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}
