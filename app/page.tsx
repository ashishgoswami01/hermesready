import Link from "next/link";
import { ArrowRight, BookOpen, ListFilter, MessageSquare, SlidersHorizontal } from "lucide-react";

const CARDS = [
  {
    icon: BookOpen,
    title: "Knowledge bank",
    body: "A Drive folder of Star Health product and process documents, chunked and indexed on a schedule you set.",
  },
  {
    icon: MessageSquare,
    title: "Session control",
    body: "Reply caps, session timeouts and quiet hours, so one conversation never runs away on its own.",
  },
  {
    icon: ListFilter,
    title: "Number routing",
    body: "A blacklist that keeps friends and family untouched, and an exclusive list for priority contacts.",
  },
  {
    icon: SlidersHorizontal,
    title: "Persona",
    body: "Separate tone for agents and customers, reply language, and a signature that reads as the training desk.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-[880px] px-6 py-20 lg:py-28">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-[var(--text)] text-[14px] font-semibold text-white">
          H
        </span>
        <span className="text-[15px] font-semibold">Hermes</span>
        <span className="chip">Phase 1</span>
      </div>

      <h1 className="mt-9 max-w-[620px] text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[46px]">
        Control center for the Hermes WhatsApp assistant.
      </h1>
      <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-text-secondary">
        A guided six-step setup that decides what Hermes knows, who it answers, how far a
        conversation can go, and how it sounds.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href="/admin/settings" className="btn btn-primary h-[38px] px-4">
          Open settings
          <ArrowRight size={15} />
        </Link>
        <span className="text-[13px] text-text-tertiary">
          Progress saves as you go — you can leave mid-setup.
        </span>
      </div>

      <div className="divider my-14" />

      <div className="grid gap-px overflow-hidden rounded-[12px] border border-border-base bg-border-base sm:grid-cols-2">
        {CARDS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="bg-surface p-5">
            <Icon size={17} strokeWidth={1.9} className="text-accent" />
            <h2 className="mt-3 text-[14px] font-semibold">{title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{body}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[12.5px] leading-relaxed text-text-tertiary">
        Internal tool for Star Health training operations. Phase 1 is frontend only — settings live
        in your browser until the backend lands.
      </p>
    </main>
  );
}
