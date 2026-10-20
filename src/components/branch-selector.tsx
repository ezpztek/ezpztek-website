import "./branch-selector.css";
import { SubmitButton } from "@/components/admin/submit-button";
export function BranchSelector({ branches, selected, action }: {
  branches: Array<{ id: string; name: string }>;
  selected: string;
  action: string;
}) {
  return <form action={action} method="get" className="client-branch-selector">
    <label>Branch <select name="branch" defaultValue={selected}>
      {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
    </select></label>
    <SubmitButton className="client-module-action" pendingLabel="Switching…">Switch branch</SubmitButton>
  </form>;
}
