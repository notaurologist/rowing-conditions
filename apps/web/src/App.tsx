import { useStoredData } from './lib/useStoredData.ts';

export function App() {
  const { locations } = useStoredData();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Rowing Conditions</h1>
      </header>
      <main className="page">
        <section aria-labelledby="locations-heading">
          <h2 id="locations-heading">Locations</h2>
          {locations.length === 0 ? (
            <p>No saved locations yet.</p>
          ) : (
            <ul>
              {locations.map((location) => (
                <li key={location.id}>{location.name}</li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
