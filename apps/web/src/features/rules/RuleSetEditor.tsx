import {
  type DisplaySystem,
  type GaugeRef,
  LIMIT_METRICS,
  type LimitWording,
  metricUnits,
  type RuleSet,
  ratioScaleMetrics,
  type SavedLocation,
  type Unit,
} from '@rowing/core';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { api, apiErrorMessage, fetchNearbyGauges } from '../../lib/api.ts';
import { metricName, tidyGaugeName, unitSymbol } from '../../lib/format.ts';
import { useAppStorage, useStoredData } from '../../lib/useStoredData.ts';
import { newId } from '../location-setup/newLocation.ts';
import { LimitExamples } from './LimitExamples.tsx';
import { selectRuleSet } from './ruleSetChoice.ts';
import {
  addLimit,
  attachRuleSet,
  checkDraft,
  type DraftErrors,
  detachRuleSet,
  draftFromRuleSet,
  emptyDraft,
  type LimitDraft,
  type RuleSetDraft,
  removeRuleSet,
  upsertRuleSet,
} from './ruleSetDraft.ts';

const WORDING_LABELS: Record<LimitWording, string> = {
  atMost: 'at most',
  below: 'below',
  atLeast: 'at least',
  above: 'above',
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Props {
  /** The rule set to edit, or undefined for a new one attached to `location` on save. */
  ruleSet: RuleSet | undefined;
  location: SavedLocation;
  units: DisplaySystem;
  onDone: () => void;
}

// Name, boat classes, limits (each worded as the club words it, in the unit it was entered
// in), an optional daylight window and an optional flow gauge. Nothing is prefilled except one
// "All boats" class: the limits are the user's or their club's, never ours.
export function RuleSetEditor({ ruleSet, location, units, onDone }: Props) {
  const storage = useAppStorage();
  const { ruleSets, locations, preferences } = useStoredData();
  const [draft, setDraft] = useState<RuleSetDraft>(() =>
    ruleSet ? draftFromRuleSet(ruleSet) : emptyDraft(),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useId();

  const hasFlowLimit = draft.limits.some((l) => l.metric === 'flow');
  const gaugesQuery = useQuery({
    queryKey: ['gauges', 'nearby', location.lat, location.lon],
    queryFn: () => fetchNearbyGauges(api, location),
    enabled: hasFlowLimit,
  });

  // Editing a field clears its error, so a fixed entry doesn't still read as wrong.
  const clearErrors = (keys: string[]) =>
    setErrors((e) => {
      if (!keys.some((k) => k in e)) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  const update = (change: Partial<RuleSetDraft>, ...fixes: string[]) => {
    setDraft((d) => ({ ...d, ...change }));
    clearErrors(fixes);
  };
  const updateLimit = (id: string, change: Partial<LimitDraft>) => {
    setDraft((d) => ({
      ...d,
      limits: d.limits.map((l) => (l.id === id ? { ...l, ...change } : l)),
    }));
    clearErrors([`limit:${id}`]);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const result = checkDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      storage.saveRuleSets(upsertRuleSet(ruleSets, result.ruleSet));
      if (!ruleSet) {
        // A new rule set is attached here and shown, since it's the one just entered.
        storage.saveLocations(attachRuleSet(locations, location.id, result.ruleSet.id));
        storage.savePreferences(selectRuleSet(preferences, location.id, result.ruleSet.id));
      }
    } catch (error) {
      setProblem(`Couldn't save the rule set: ${apiErrorMessage(error)}`);
      return;
    }
    onDone();
  };

  const detach = () => {
    if (!ruleSet) return;
    try {
      storage.saveLocations(detachRuleSet(locations, location.id, ruleSet.id));
    } catch (error) {
      setProblem(`Couldn't remove the rule set from ${location.name}: ${apiErrorMessage(error)}`);
      return;
    }
    onDone();
  };

  const remove = () => {
    if (!ruleSet) return;
    const usedBy = locations.filter((l) => l.ruleSetIds.includes(ruleSet.id)).length;
    const where = usedBy > 1 ? ` It is used by ${usedBy} locations.` : '';
    if (!window.confirm(`Delete ${ruleSet.name}?${where}`)) return;
    const next = removeRuleSet(ruleSets, locations, ruleSet.id);
    try {
      // Detach first: a location pointing at a deleted rule set would show no limits anyway.
      storage.saveLocations(next.locations);
      storage.saveRuleSets(next.ruleSets);
    } catch (error) {
      setProblem(`Couldn't delete the rule set: ${apiErrorMessage(error)}`);
      return;
    }
    onDone();
  };

  const errorId = (key: string) => `${ids}-${key}-error`;
  const fieldError = (key: string) =>
    errors[key] ? (
      <span id={errorId(key)} className="field-error">
        {errors[key]}
      </span>
    ) : null;
  const invalid = (key: string) =>
    errors[key] ? { 'aria-invalid': true, 'aria-describedby': errorId(key) } : {};

  return (
    <section className="rule-editor" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>{ruleSet ? `Edit ${ruleSet.name}` : 'New rule set'}</h2>
      <p className="hint">
        Enter your club’s limits, or your own. The app has no limits of its own: it only shows when
        conditions are within or outside the limits you enter.
      </p>
      <LimitExamples />

      <form className="rule-editor-form" onSubmit={save} noValidate>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value }, 'name')}
            placeholder="e.g. Riverside Rowing Club"
            maxLength={80}
            {...invalid('name')}
          />
          {fieldError('name')}
        </label>

        <fieldset className="rule-editor-group">
          <legend>Boat classes</legend>
          <p className="hint">
            Add classes only if your limits differ by boat, for example singles and doubles versus
            eights.
          </p>
          {draft.boatClasses.map((c, i) => (
            <div key={c.id} className="field">
              <div className="rule-editor-row">
                <input
                  type="text"
                  aria-label={`Boat class ${i + 1}`}
                  value={c.name}
                  onChange={(e) =>
                    update(
                      {
                        boatClasses: draft.boatClasses.map((b) =>
                          b.id === c.id ? { ...b, name: e.target.value } : b,
                        ),
                      },
                      `class:${c.id}`,
                    )
                  }
                  maxLength={60}
                  {...invalid(`class:${c.id}`)}
                />
                {draft.boatClasses.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        { boatClasses: draft.boatClasses.filter((b) => b.id !== c.id) },
                        `class:${c.id}`,
                      )
                    }
                  >
                    Remove
                    <span className="visually-hidden"> {c.name || `boat class ${i + 1}`}</span>
                  </button>
                )}
              </div>
              {fieldError(`class:${c.id}`)}
            </div>
          ))}
          {fieldError('classes')}
          <div>
            <button
              type="button"
              onClick={() =>
                update(
                  { boatClasses: [...draft.boatClasses, { id: newId(), name: '' }] },
                  'classes',
                )
              }
            >
              Add boat class
            </button>
          </div>
        </fieldset>

        <fieldset className="rule-editor-group">
          <legend>Limits</legend>
          {draft.limits.length === 0 && (
            <p className="rule-editor-empty">
              No limits yet. Add each limit from your club’s rules, or your own, in the units they
              are written in.
            </p>
          )}
          {draft.limits.map((limit) => (
            <LimitRow
              key={limit.id}
              limit={limit}
              boatClasses={draft.boatClasses}
              error={fieldError(`limit:${limit.id}`)}
              invalid={invalid(`limit:${limit.id}`)}
              onChange={(change) => updateLimit(limit.id, change)}
              onRemove={() =>
                update(
                  { limits: draft.limits.filter((l) => l.id !== limit.id) },
                  `limit:${limit.id}`,
                )
              }
            />
          ))}
          <label className="field">
            <span>Add a limit</span>
            <select
              value=""
              onChange={(e) => {
                const metric = e.target.value as LimitDraft['metric'];
                if (metric) setDraft((d) => addLimit(d, metric, units));
              }}
            >
              <option value="">Choose what the limit is on…</option>
              {LIMIT_METRICS.map((m) => (
                <option key={m} value={m}>
                  {capitalize(metricName(m))}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        {hasFlowLimit && (
          <label className="field">
            <span>Gauge for the flow limit</span>
            <select
              value={draft.flowGaugeRef}
              onChange={(e) => update({ flowGaugeRef: e.target.value as GaugeRef | '' })}
            >
              <option value="">
                {location.gaugeRef ? 'This location’s gauge' : 'None (this location has no gauge)'}
              </option>
              {(gaugesQuery.data ?? [])
                .filter((g) => g.ref !== location.gaugeRef)
                .map((g) => (
                  <option key={g.ref} value={g.ref}>
                    {tidyGaugeName(g.name)}
                  </option>
                ))}
              {draft.flowGaugeRef &&
                !(gaugesQuery.data ?? []).some((g) => g.ref === draft.flowGaugeRef) && (
                  <option value={draft.flowGaugeRef}>{draft.flowGaugeRef}</option>
                )}
            </select>
            <span className="field-hint">
              {gaugesQuery.isError
                ? `Couldn't load nearby gauges: ${apiErrorMessage(gaugesQuery.error)}`
                : 'Clubs often measure their flow limit at one particular gauge.'}
            </span>
          </label>
        )}

        <fieldset className="rule-editor-group">
          <legend>Daylight window</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.daylight.enabled}
              onChange={(e) =>
                update(
                  { daylight: { ...draft.daylight, enabled: e.target.checked } },
                  'daylight.before',
                  'daylight.after',
                )
              }
            />
            <span>My club forbids rowing outside set hours</span>
          </label>
          <p className="hint">
            Only if your club forbids rowing outside these hours. Otherwise leave it off: dawn, dusk
            and darkness are shown on the chart either way.
          </p>
          {draft.daylight.enabled && (
            <div className="rule-editor-row">
              <label className="field">
                <span>Minutes before sunrise</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={draft.daylight.before}
                  onChange={(e) =>
                    update(
                      { daylight: { ...draft.daylight, before: e.target.value } },
                      'daylight.before',
                    )
                  }
                  {...invalid('daylight.before')}
                />
                {fieldError('daylight.before')}
              </label>
              <label className="field">
                <span>Minutes after sunset</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={draft.daylight.after}
                  onChange={(e) =>
                    update(
                      { daylight: { ...draft.daylight, after: e.target.value } },
                      'daylight.after',
                    )
                  }
                  {...invalid('daylight.after')}
                />
                {fieldError('daylight.after')}
              </label>
            </div>
          )}
        </fieldset>

        {(problem || Object.keys(errors).length > 0) && (
          <p role="alert" className="notice notice-error">
            {problem ?? errors.form ?? 'Some entries need fixing. Each one is marked above.'}
          </p>
        )}

        <div className="setup-actions">
          <button type="submit" className="primary">
            Save rule set
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
          {ruleSet && location.ruleSetIds.includes(ruleSet.id) && (
            <button type="button" onClick={detach}>
              Remove from {location.name}
            </button>
          )}
          {ruleSet && (
            <button type="button" className="danger" onClick={remove}>
              Delete rule set
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function LimitRow({
  limit,
  boatClasses,
  error,
  invalid,
  onChange,
  onRemove,
}: {
  limit: LimitDraft;
  boatClasses: RuleSetDraft['boatClasses'];
  error: React.ReactNode;
  invalid: object;
  onChange: (change: Partial<LimitDraft>) => void;
  onRemove: () => void;
}) {
  const name = capitalize(metricName(limit.metric));
  const units = metricUnits[limit.metric];
  return (
    <div className="limit-row">
      <div className="limit-sentence">
        <span className="limit-metric">{name}</span>
        <span className="limit-inputs">
          <select
            aria-label={`${name}: wording`}
            value={limit.wording}
            onChange={(e) => onChange({ wording: e.target.value as LimitWording })}
          >
            {(Object.keys(WORDING_LABELS) as LimitWording[]).map((w) => (
              <option key={w} value={w}>
                {WORDING_LABELS[w]}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode={ratioScaleMetrics.includes(limit.metric) ? 'decimal' : 'text'}
            aria-label={`${name}: limit`}
            className="limit-value"
            value={limit.value}
            onChange={(e) => onChange({ value: e.target.value })}
            {...invalid}
          />
          {units.length > 1 ? (
            <select
              aria-label={`${name}: unit`}
              value={limit.unit}
              onChange={(e) => onChange({ unit: e.target.value as Unit })}
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {unitSymbol(u)}
                </option>
              ))}
            </select>
          ) : (
            <span className="limit-unit">{unitSymbol(limit.unit)}</span>
          )}
        </span>
        <button type="button" className="link-button limit-remove" onClick={onRemove}>
          Remove<span className="visually-hidden"> {metricName(limit.metric)} limit</span>
        </button>
      </div>
      {error}
      {boatClasses.length > 1 && (
        <fieldset className="limit-classes">
          <legend>Applies to (none ticked: every boat class)</legend>
          {boatClasses.map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={limit.boatClassIds.includes(c.id)}
                onChange={(e) =>
                  onChange({
                    boatClassIds: e.target.checked
                      ? [...limit.boatClassIds, c.id]
                      : limit.boatClassIds.filter((id) => id !== c.id),
                  })
                }
              />
              <span>{c.name || 'Unnamed class'}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
