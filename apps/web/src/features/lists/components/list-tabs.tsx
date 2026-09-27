import type { ListSummary } from "@grocery/shared";

interface ListTabsProps {
  lists: ListSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

const tabBaseClass =
  "flex min-h-10 shrink-0 items-center rounded-t-lg px-3 text-sm font-medium transition " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600";
const tabSelectedClass = "border-b-2 border-green-600 bg-white text-green-700";
const tabIdleClass = "border-b-2 border-transparent text-gray-500 hover:text-gray-700";

/** Top tabs — one per list (docs/PROJECT.md → UX: "Multiple lists, switchable via top tabs"). */
export function ListTabs({ lists, selectedId, onSelect, onCreate }: ListTabsProps) {
  return (
    <div role="tablist" aria-label="Your lists" className="flex items-end gap-1 overflow-x-auto">
      {lists.map((list) => {
        const selected = list.id === selectedId;
        return (
          <button
            key={list.id}
            id={`tab-${list.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="list-panel"
            onClick={() => onSelect(list.id)}
            className={`${tabBaseClass} ${selected ? tabSelectedClass : tabIdleClass}`}
          >
            {list.title}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        aria-label="New list"
        className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
      >
        +
      </button>
    </div>
  );
}
