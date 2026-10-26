// What the app does and doesn't do, shown on first use and from the header's About button.
// The wording follows decision 0001 (conditions, not verdicts). Raise INTRO_VERSION when the
// disclaimer changes, so everyone sees the new text once.
export const INTRO_VERSION = 1;

export function Intro({ onContinue, firstUse }: { onContinue: () => void; firstUse: boolean }) {
  return (
    <section className="intro" aria-labelledby="intro-heading">
      <h2 id="intro-heading">About Rowing Conditions</h2>

      <h3>What it does</h3>
      <ul>
        <li>
          Shows river flow, water temperature, wind, weather, and daylight for the place you row,
          now and for the next 48 hours.
        </li>
        <li>
          Compares each hour with limits you enter, or your club's. Every hour is shown as within
          your limits, outside them, or unknown when data is missing.
        </li>
        <li>It has no limits of its own. Until you enter some, it shows conditions only.</li>
      </ul>

      <h3>What it doesn't do</h3>
      <ul>
        <li>
          It doesn't say whether conditions are safe, or whether to row. That stays with you, your
          coach, and your club's rules.
        </li>
        <li>
          It can't see what matters on the water: debris, ice, fog, your crew's experience, launch
          cover, or local hazards.
        </li>
        <li>
          Its data comes from USGS, NOAA, and the National Weather Service. Readings can be late,
          missing, or wrong, and forecasts change. Each reading shows its source and age.
        </li>
      </ul>

      <h3>Disclaimer</h3>
      <p className="intro-disclaimer">
        Rowing Conditions is provided as is, without warranty of any kind. It is information, not
        advice. You are responsible for your own safety and your crew's. Follow your club's rules
        and look at the water before you go out.
      </p>

      <div className="setup-actions">
        <button type="button" className="primary" onClick={onContinue}>
          {firstUse ? 'Continue' : 'Close'}
        </button>
      </div>
    </section>
  );
}
