"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function InventoryCategoryFilter({
  categories,
  selectedCategory,
  shownCount,
  totalCount,
}: {
  categories: string[];
  selectedCategory: string;
  shownCount: number;
  totalCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function selectCategory(category: string) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (category) nextParams.set("category", category);
    else nextParams.delete("category");
    nextParams.delete("created");
    nextParams.delete("updated");
    nextParams.delete("error");

    const query = nextParams.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="inventory-category-filter" aria-busy={isPending}>
      <label htmlFor="inventory-category-filter">Filter by category</label>
      <select
        id="inventory-category-filter"
        value={selectedCategory}
        onChange={(event) => selectCategory(event.target.value)}
        disabled={isPending || !categories.length}
      >
        <option value="">All categories</option>
        {categories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      <span aria-live="polite">
        {isPending ? "Filtering…" : `${shownCount} of ${totalCount} items`}
      </span>
    </div>
  );
}
