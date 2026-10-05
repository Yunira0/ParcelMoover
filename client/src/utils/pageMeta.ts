import { useEffect } from 'react';

// index.html carries the site-wide tags (correct for "/"). Public pages refine
// them here so each one is indexed under its own title, description and
// canonical URL. Restored on unmount, so a page reached afterwards (including
// the dashboard after login) never keeps a public page's tags.

export const SITE_ORIGIN = 'https://portal.parcelmoover.com';

interface PageMeta {
  title: string;
  description: string;
  /** Path of the canonical URL, e.g. "/track". */
  path: string;
}

function headTag(selector: string, create: () => HTMLElement): HTMLElement {
  return document.head.querySelector<HTMLElement>(selector) ?? document.head.appendChild(create());
}

const meta = (attr: 'name' | 'property', key: string) =>
  headTag(`meta[${attr}="${key}"]`, () => {
    const el = document.createElement('meta');
    el.setAttribute(attr, key);
    return el;
  });

export function usePageMeta({ title, description, path }: PageMeta) {
  useEffect(() => {
    const url = `${SITE_ORIGIN}${path}`;
    const canonical = headTag('link[rel="canonical"]', () => {
      const el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      return el;
    });
    const targets: Array<[HTMLElement, string, string]> = [
      [meta('name', 'description'), 'content', description],
      [meta('property', 'og:title'), 'content', title],
      [meta('property', 'og:description'), 'content', description],
      [meta('property', 'og:url'), 'content', url],
      [meta('name', 'twitter:title'), 'content', title],
      [meta('name', 'twitter:description'), 'content', description],
      [canonical, 'href', url],
    ];

    const previousTitle = document.title;
    const previous = targets.map(([el, attr]) => el.getAttribute(attr));
    document.title = title;
    for (const [el, attr, value] of targets) el.setAttribute(attr, value);

    return () => {
      document.title = previousTitle;
      targets.forEach(([el, attr], i) => {
        const value = previous[i];
        if (value === null) el.removeAttribute(attr);
        else el.setAttribute(attr, value);
      });
    };
  }, [title, description, path]);
}
