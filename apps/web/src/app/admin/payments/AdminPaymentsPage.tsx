import { Link } from "react-router-dom";
import { ScreenPlaceholder } from "../../../components/ScreenPlaceholder";

/** Approval queue isn't built yet — payments/routes.ts is still a scaffold
 * stub (no listing/approve endpoints). This just keeps the page reachable
 * from and back to the admin hub instead of a dead end. */
export function AdminPaymentsPage() {
  return (
    <div className="flex min-h-dvh flex-col text-text">
      <div className="flex h-[70px] flex-none items-center gap-3 border-b border-border px-8">
        <Link to="/admin" className="text-[13px] text-text-tertiary hover:text-text">
          Admin
        </Link>
        <span className="text-text-tertiary">/</span>
        <span className="text-[20px] font-bold tracking-[-0.02em]">Aprovação de Pagamentos</span>
      </div>
      <div className="flex-1">
        <ScreenPlaceholder label="Aprovação de Pagamentos" />
      </div>
    </div>
  );
}
