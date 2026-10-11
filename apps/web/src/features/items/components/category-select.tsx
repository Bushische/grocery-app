import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { useState } from "react";

export interface CategoryOption {
  id: string;
  title: string;
  color: string;
}

export interface CategoryComboboxProps {
  /** All categories in API order (creation order); shown unfiltered by default. */
  categories: CategoryOption[];
  /** Selected category id (RHF `categoryId` field value). */
  value: string;
  onChange: (categoryId: string) => void;
  onBlur?: () => void;
}

/**
 * Category picker (T93): a product-pickup-style combobox — the full list shows
 * by default, typing narrows it by substring, every row carries the assigned
 * color swatch. Replaces the native select (whose `<option>` rows cannot show
 * swatches, especially on mobile browsers). Uncommitted typing is discarded on
 * blur so the field always reflects a real category id. The options render
 * non-modal: HeadlessUI's modal listbox inerts the rest of the page while
 * open, which would leave the form's Save button unreachable after `immediate`
 * re-opens the list on the post-select input refocus.
 */
export function CategoryCombobox({ categories, value, onChange, onBlur }: CategoryComboboxProps) {
  const [query, setQuery] = useState<string | null>(null);
  const selected = categories.find((category) => category.id === value) ?? null;
  const needle = (query ?? "").trim().toLowerCase();
  const visible =
    needle === ""
      ? categories
      : categories.filter((category) => category.title.toLowerCase().includes(needle));

  return (
    <Combobox
      value={selected}
      onChange={(category) => {
        if (category) onChange(category.id);
        setQuery(null);
      }}
      onClose={() => setQuery(null)}
      immediate
    >
      <div className="relative mt-1">
        <ComboboxInput
          id="item-category"
          aria-label="Category"
          autoComplete="off"
          placeholder="Pick or type a category…"
          value={query ?? selected?.title ?? ""}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={onBlur}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 placeholder:text-gray-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600"
        />
        <ComboboxOptions
          data-testid="category-combobox-list"
          modal={false}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg empty:invisible"
        >
          {visible.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-gray-500">No categories match.</p>
          ) : null}
          {visible.map((category) => (
            <ComboboxOption
              key={category.id}
              value={category}
              data-testid={`category-option-${category.id}`}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-left data-[focus]:bg-gray-100"
            >
              {({ selected: isSelected }) => (
                <>
                  <span
                    aria-hidden="true"
                    data-testid={`category-swatch-${category.id}`}
                    className="h-6 w-1.5 shrink-0 rounded"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                    {category.title}
                  </span>
                  {isSelected ? (
                    <span aria-hidden="true" className="shrink-0 text-sm text-green-700">
                      ✓
                    </span>
                  ) : null}
                </>
              )}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}
