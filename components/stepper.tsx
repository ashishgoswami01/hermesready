"use client";

import { Check, Lock } from "lucide-react";
import { STEPS } from "@/lib/settings";

export function Stepper({
  current,
  completed,
  onSelect,
}: {
  current: number;
  completed: number[];
  onSelect: (step: number) => void;
}) {
  const reachable = (id: number) =>
    id === 1 || completed.includes(id) || completed.includes(id - 1);

  return (
    <nav aria-label="Setup steps" className="hidden w-[250px] shrink-0 md:block">
      <ol className="relative">
        {STEPS.map((step, i) => {
          const isDone = completed.includes(step.id);
          const isCurrent = current === step.id;
          const open = reachable(step.id);
          const last = i === STEPS.length - 1;

          return (
            <li key={step.id} className="relative">
              {!last && (
                <span
                  aria-hidden
                  className={`absolute left-[13px] top-[26px] h-[calc(100%-14px)] w-[1.5px] ${
                    isDone ? "bg-success/40" : "bg-border-base"
                  }`}
                />
              )}
              <button
                type="button"
                onClick={() => open && onSelect(step.id)}
                disabled={!open}
                aria-current={isCurrent ? "step" : undefined}
                className={`group flex w-full items-start gap-3 rounded-[8px] py-2 pl-1 pr-2 text-left transition-colors ${
                  open ? "cursor-pointer hover:bg-surface-hover" : "cursor-not-allowed"
                }`}
              >
                <span
                  className={`relative mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border text-[11.5px] font-semibold transition-colors ${
                    isDone
                      ? "border-success bg-success text-white"
                      : isCurrent
                        ? "border-accent bg-accent text-white"
                        : open
                          ? "border-border-strong bg-surface text-text-tertiary"
                          : "border-border-base bg-surface-subtle text-text-tertiary"
                  }`}
                >
                  {isDone ? (
                    <Check size={13} strokeWidth={3} />
                  ) : open ? (
                    step.id
                  ) : (
                    <Lock size={11} strokeWidth={2.2} />
                  )}
                </span>
                <span className="min-w-0 pt-[2px]">
                  <span
                    className={`block truncate text-[13.5px] ${
                      isCurrent ? "font-semibold text-text" : "font-medium text-text-secondary"
                    }`}
                  >
                    {step.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-text-tertiary">
                    {step.desc}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StepperMobile({
  current,
  completed,
  onSelect,
}: {
  current: number;
  completed: number[];
  onSelect: (step: number) => void;
}) {
  const reachable = (id: number) =>
    id === 1 || completed.includes(id) || completed.includes(id - 1);

  return (
    <div className="mb-4 flex items-center gap-1.5 md:hidden">
      {STEPS.map((step) => {
        const isDone = completed.includes(step.id);
        const isCurrent = current === step.id;
        const open = reachable(step.id);
        return (
          <button
            key={step.id}
            type="button"
            aria-label={`Step ${step.id}: ${step.title}`}
            disabled={!open}
            onClick={() => open && onSelect(step.id)}
            className={`h-[5px] flex-1 rounded-full transition-colors ${
              isCurrent
                ? "bg-accent"
                : isDone
                  ? "bg-success/60"
                  : "bg-border-strong"
            }`}
          />
        );
      })}
    </div>
  );
}
