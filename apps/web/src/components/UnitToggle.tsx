import type { DisplaySystem } from '@rowing/core';

const OPTIONS: { value: DisplaySystem; label: string }[] = [
  { value: 'us', label: 'US' },
  { value: 'metric', label: 'Metric' },
];

// The pressed state is shown by aria-pressed and a check mark, not by color alone.
export function UnitToggle({
  units,
  onChange,
}: {
  units: DisplaySystem;
  onChange: (units: DisplaySystem) => void;
}) {
  return (
    <fieldset className="unit-toggle">
      <legend className="visually-hidden">Units</legend>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={units === option.value}
          onClick={() => onChange(option.value)}
        >
          {units === option.value && <span aria-hidden="true">✓ </span>}
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
