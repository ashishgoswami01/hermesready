import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label">{label}</label>
        {optional && (
          <span className="text-[11.5px] text-text-tertiary">Optional</span>
        )}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-danger">
          <AlertCircle size={13} className="mt-[1px] shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2">{children}</div>;
}

export function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-start gap-3 rounded-[8px] border border-border-base bg-surface p-3.5 text-left transition-colors hover:bg-surface-hover"
    >
      <span
        className={`mt-0.5 flex h-[18px] w-[32px] shrink-0 items-center rounded-full p-[2px] transition-colors ${
          checked ? "bg-accent" : "bg-border-strong"
        }`}
      >
        <span
          className={`h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[14px]" : ""
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-tertiary">
          {desc}
        </span>
      </span>
    </button>
  );
}

export function CheckPill({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`h-8 rounded-[7px] border px-3 text-[13px] font-medium transition-colors ${
        checked
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border-strong bg-surface text-text-secondary hover:bg-surface-hover"
      }`}
    >
      {label}
    </button>
  );
}
