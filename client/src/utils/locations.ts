interface HubLike {
  id: string;
  code?: string | null;
  name: string;
  parentId?: string | null;
  parent_id?: string | null;
}

/**
 * The master (Imadol) hub: the top-level IMADOL row — never a covered area
 * that happens to share the name. An orphaned child row called IMADOL exists,
 * and matching by name alone resolves to it whenever it sorts first (the
 * locations list is newest-first), silently re-homing vendors, riders, and
 * order origins to a dead location. Code match wins; top-level wins ties.
 */
export function findMasterHub<T extends HubLike>(locations: T[]): T | undefined {
  const byCode = (l: T) => (l.code || '').toUpperCase() === 'IMADOL';
  const parentOf = (l: T) => l.parentId ?? l.parent_id ?? null;
  return (
    locations.find((l) => byCode(l) && !parentOf(l)) ??
    locations.find((l) => byCode(l)) ??
    locations.find((l) => !parentOf(l) && l.name.trim().toLowerCase() === 'imadol')
  );
}
