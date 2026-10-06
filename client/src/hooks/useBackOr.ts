import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Back to wherever the user came from inside the app, keeping that page's
 * filters - or, when this page was the first one opened (a notification, a
 * pasted link, a new tab), to `fallback` instead of leaving the app.
 *
 * React Router gives the very first entry of a session the key "default".
 */
export function useBackOr(fallback: string) {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    if (key !== 'default') navigate(-1);
    else navigate(fallback);
  }, [key, navigate, fallback]);
}
