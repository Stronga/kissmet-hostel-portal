import { LogOut } from "lucide-react";
import { Button } from "../common/Button";
import { portalTitle } from "./navigation";

interface ResidentHeaderProps {
  displayName?: string;
  onLogout: () => void;
}

export function ResidentHeader({ displayName, onLogout }: ResidentHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Kissmet</p>
          <h1 className="text-base font-semibold text-text-primary md:text-lg">{portalTitle}</h1>
        </div>
        <div className="flex items-center gap-3">
          {displayName ? <span className="hidden text-sm text-text-secondary sm:block">{displayName}</span> : null}
          <Button variant="ghost" className="gap-2 px-3" onClick={onLogout} aria-label="Logout">
            <LogOut size={18} />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
