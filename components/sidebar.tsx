"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LayoutDashboard,
  ListFilter,
  MessageSquare,
  ScrollText,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, soon: false },
  { href: "/admin/settings", label: "Settings", icon: Settings, soon: false },
  { href: "/admin/knowledge", label: "Knowledge bank", icon: BookOpen, soon: false },
  { href: "/admin/chat", label: "Ask Hermes", icon: MessageSquare, soon: false },
  { href: "/admin/numbers", label: "Numbers", icon: ListFilter, soon: true },
  { href: "/admin/logs", label: "Activity log", icon: ScrollText, soon: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[236px] shrink-0 border-r border-border-base bg-surface-subtle lg:flex lg:flex-col">
      <div className="flex h-[52px] items-center gap-2.5 px-4">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[var(--text)] text-[13px] font-semibold text-white">
          H
        </span>
        <div className="leading-tight">
          <div className="text-[13.5px] font-semibold">Hermes</div>
          <div className="text-[11px] text-text-tertiary">Control Center</div>
        </div>
      </div>

      <nav className="flex-1 px-2 pt-2">
        {NAV.map(({ href, label, icon: Icon, soon }) => {
          const active = pathname === href;
          const cls =
            "mb-0.5 flex h-[32px] items-center gap-2.5 rounded-[7px] px-2.5 text-[13.5px] transition-colors";

          if (soon) {
            return (
              <div
                key={href}
                className={`${cls} cursor-default text-text-tertiary`}
                title="Coming in a later phase"
              >
                <Icon size={15} strokeWidth={1.9} />
                <span className="flex-1 truncate">{label}</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  Soon
                </span>
              </div>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              className={`${cls} ${
                active
                  ? "bg-surface font-medium text-text shadow-[0_1px_2px_rgba(23,23,26,0.05)]"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Icon size={15} strokeWidth={1.9} />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="m-2 rounded-[8px] border border-border-base bg-surface p-3">
        <div className="eyebrow">Phase 2</div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
          Upload, indexing and grounded answers are live. WhatsApp routing is next.
        </p>
      </div>
    </aside>
  );
}
