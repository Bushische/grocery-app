import type { Item, ItemCategory } from "@grocery/shared";

export interface ItemGroup {
  category: ItemCategory;
  items: Item[];
}

/** Minimal shape the drop computation needs (id + category). */
export type Groupable = { id: string; category: { id: string } };

/**
 * Groups one status section by category (T75): items sort by sortOrder, groups
 * order by first-item position, so groups stay contiguous without touching
 * category sortOrder. Coalesces interleaved rows (same category in one group).
 */
export function groupSectionItems(sectionItems: Item[]): ItemGroup[] {
  const ordered = [...sectionItems].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups = new Map<string, ItemGroup>();
  for (const item of ordered) {
    const existing = groups.get(item.category.id);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.category.id, { category: item.category, items: [item] });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Math.min(...a.items.map((item) => item.sortOrder)) -
      Math.min(...b.items.map((item) => item.sortOrder)),
  );
}

/**
 * Group-aware drop computation (T75, pure): the section order passed in is the
 * currently displayed (grouped) order.
 *
 * - inside-group drop → reorder within the group run (other groups untouched);
 * - cross-group drop → the dragged item moves to the top of its own group and
 *   its whole group block moves immediately above the target's group, e.g.
 *   `a-a2-a-a-b-b2-b` with b2 above a2 → `b2-b-b-a-a2-a-a`;
 * - same-item or unknown ids → null (no-op, no POST).
 */
export function groupAwareReorderedIds<T extends Groupable>(
  sectionItems: T[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const ids = sectionItems.map((item) => item.id);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return null;

  const activeCat = sectionItems[from]!.category.id;
  const overCat = sectionItems[to]!.category.id;

  if (activeCat === overCat) {
    const groupIds = sectionItems
      .filter((item) => item.category.id === activeCat)
      .map((item) => item.id);
    const posActive = groupIds.indexOf(activeId);
    const posOver = groupIds.indexOf(overId);
    if (posActive === -1 || posOver === -1 || posActive === posOver) return null;
    const reordered = [...groupIds];
    const [moved] = reordered.splice(posActive, 1);
    reordered.splice(posOver, 0, moved!);
    let cursor = 0;
    const next = sectionItems.map((item) =>
      item.category.id === activeCat ? reordered[cursor++]! : item.id,
    );
    return next.every((id, index) => id === ids[index]) ? null : next;
  }

  const activeBlock = [
    activeId,
    ...sectionItems
      .filter((item) => item.category.id === activeCat && item.id !== activeId)
      .map((item) => item.id),
  ];
  const withoutActive = sectionItems.filter((item) => item.category.id !== activeCat);
  const overFirstIndex = withoutActive.findIndex((item) => item.category.id === overCat);
  if (overFirstIndex === -1) return null;
  const next: string[] = [
    ...withoutActive.slice(0, overFirstIndex).map((item) => item.id),
    ...activeBlock,
    ...withoutActive.slice(overFirstIndex).map((item) => item.id),
  ];
  return next.every((id, index) => id === ids[index]) ? null : next;
}
