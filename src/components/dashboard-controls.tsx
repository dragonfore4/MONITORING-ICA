"use client";

/**
 * Dashboard controls: time window, sort order, provider filter, grouping and
 * axis scale. Kept in one component so the toolbar stays visually consistent.
 */
import type { Provider } from "@/lib/providers";

export type SortKey = "latency" | "name" | "p95" | "success" | "provider";
export type GroupMode = "none" | "provider";

/** Small segmented control used throughout the toolbar. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.title}
          className={`rounded px-2.5 py-1 text-xs transition ${
            value === o.value
              ? "bg-zinc-700 text-zinc-50"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Labelled wrapper so each control's purpose is obvious. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  );
}

export function DashboardControls({
  hours,
  onHours,
  sort,
  onSort,
  group,
  onGroup,
  logScale,
  onLogScale,
  providers,
  activeProviders,
  onToggleProvider,
  onAllProviders,
}: {
  hours: number;
  onHours: (h: number) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  group: GroupMode;
  onGroup: (g: GroupMode) => void;
  logScale: boolean;
  onLogScale: (v: boolean) => void;
  providers: Provider[];
  activeProviders: Set<string>;
  onToggleProvider: (id: string) => void;
  onAllProviders: () => void;
}) {
  const allActive = activeProviders.size === 0;

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <Field label="Window">
        <Segmented
          value={String(hours)}
          onChange={(v) => onHours(Number(v))}
          options={[
            { value: "1", label: "1h" },
            { value: "6", label: "6h" },
            { value: "24", label: "24h" },
            { value: "168", label: "7d" },
          ]}
        />
      </Field>

      <Field label="Sort by">
        <Segmented<SortKey>
          value={sort}
          onChange={onSort}
          options={[
            { value: "latency", label: "Latency", title: "Fastest average first" },
            { value: "p95", label: "p95", title: "Best worst-case first" },
            { value: "success", label: "Success", title: "Most reliable first" },
            { value: "name", label: "Name", title: "Alphabetical" },
            { value: "provider", label: "Provider", title: "Grouped by vendor" },
          ]}
        />
      </Field>

      <Field label="Group">
        <Segmented<GroupMode>
          value={group}
          onChange={onGroup}
          options={[
            { value: "none", label: "Flat" },
            { value: "provider", label: "By provider" },
          ]}
        />
      </Field>

      <Field label="Chart scale">
        <Segmented
          value={logScale ? "log" : "linear"}
          onChange={(v) => onLogScale(v === "log")}
          options={[
            {
              value: "log",
              label: "Log",
              title: "Keeps fast models readable alongside slow outliers",
            },
            { value: "linear", label: "Linear", title: "True proportions" },
          ]}
        />
      </Field>

      <Field label="Providers">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={onAllProviders}
            className={`rounded border px-2 py-1 text-xs transition ${
              allActive
                ? "border-zinc-600 bg-zinc-700 text-zinc-50"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All
          </button>
          {providers.map((p) => {
            const on = allActive || activeProviders.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => onToggleProvider(p.id)}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition ${
                  on
                    ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: p.colour, opacity: on ? 1 : 0.35 }}
                />
                {p.label}
              </button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}
