import type { RuleSet } from '@rowing/core';
import type { RuleSetChoice } from './ruleSetChoice.ts';

interface Props {
  choices: readonly RuleSetChoice[]; // the location's rule sets
  ruleSets: readonly RuleSet[]; // every stored rule set, for attaching one used elsewhere
  onSelect: (ruleSetId: string) => void;
  onBoatClass: (ruleSetId: string, boatClassId: string) => void;
  onAttach: (ruleSetId: string) => void;
  onEdit: (ruleSetId: string | null) => void; // null: a new rule set
}

// Which rule set the answer and chart follow, and for which boat class. Every attached rule set
// keeps its own status strip either way. Also where rule sets are added, attached and edited.
export function RuleSetBar({ choices, ruleSets, onSelect, onBoatClass, onAttach, onEdit }: Props) {
  const selected = choices.find((c) => c.selected);
  const unattached = ruleSets.filter((r) => !choices.some((c) => c.ruleSet.id === r.id));

  return (
    <section className="rule-set-bar" aria-label="Rule sets">
      {choices.length > 1 && (
        <fieldset className="segmented">
          <legend className="visually-hidden">Rule set the answer and chart follow</legend>
          {choices.map((c) => (
            <button
              key={c.ruleSet.id}
              type="button"
              aria-pressed={c.selected}
              onClick={() => onSelect(c.ruleSet.id)}
            >
              {c.selected && <span aria-hidden="true">✓ </span>}
              {c.ruleSet.name}
            </button>
          ))}
        </fieldset>
      )}

      {selected && selected.ruleSet.boatClasses.length > 1 && (
        <label className="field inline">
          <span>Boat class</span>
          <select
            value={selected.boatClassId}
            onChange={(e) => onBoatClass(selected.ruleSet.id, e.target.value)}
          >
            {selected.ruleSet.boatClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="rule-set-actions">
        {selected && (
          <button type="button" onClick={() => onEdit(selected.ruleSet.id)}>
            Edit {selected.ruleSet.name}
          </button>
        )}
        <button type="button" onClick={() => onEdit(null)}>
          {choices.length === 0 ? 'Enter limits' : 'New rule set'}
        </button>
        {unattached.length > 0 && (
          <label className="field inline">
            <span className="visually-hidden">Add a rule set used elsewhere</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onAttach(e.target.value);
              }}
            >
              <option value="">Add one you have…</option>
              {unattached.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </section>
  );
}
