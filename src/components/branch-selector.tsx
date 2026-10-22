"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useTransition } from "react";
import "./branch-selector.css";

export function BranchSelector({ branches, selected, action }: {
  branches: Array<{ id: string; name: string }>;
  selected: string;
  action: string;
}) {
  const router = useRouter();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [isPending, startTransition] = useTransition();

  function switchBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const branchId = selectRef.current?.value;
    if (!branchId || branchId === selected) return;
    const query = new URLSearchParams({ branch: branchId });
    startTransition(() => router.replace(`${action}?${query}`));
  }

  return (
    <form className="client-branch-selector" onSubmit={switchBranch} aria-busy={isPending}>
      <label>Branch <select
        ref={selectRef}
        name="branch"
        defaultValue={selected}
        disabled={isPending}
      >
        {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
      </select></label>
      <button className="client-module-action" type="submit" disabled={isPending}>
        {isPending && <span className="client-inline-spinner dark" aria-hidden="true" />}
        {isPending ? "Switching…" : "Switch branch"}
      </button>
    </form>
  );
}
