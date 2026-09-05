import { useState } from 'react';

function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientInput: input }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch (jsonError) {
        data = {};
      }

      if (!res.ok) {
        const fallbackMessage =
          res.status === 429
            ? 'Request rate limit reached. Please wait 1 minute before trying again.'
            : 'Something went wrong';

        setError(data.message || data.error || fallbackMessage);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError('Could not reach the server. Is it running on port 5000?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Freelance Client Brief Generator</h1>
      <p className="subtitle">Paste a vague client request and see the AI break it down.</p>

      <form onSubmit={handleSubmit}>
        <textarea
          rows={4}
          placeholder='e.g. "I want an app like Zomato but simpler"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Generating...' : 'Generate Brief'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="results">
          <div className="card summary-card">
            <h3>Project Summary</h3>
            <p>{result.summary || 'No summary provided.'}</p>
          </div>

          <div className="card">
            <h3>Scope</h3>
            <p>{result.scope}</p>
          </div>

          <div className="results-grid">
            <div className="card">
              <h3>Tech Suggestions</h3>
              <ul>
                {result.techSuggestions?.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            <div className="card redflag">
              <h3>Red Flags</h3>
              <ul>
                {result.redFlags?.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3>Questions to Ask</h3>
              <ul>
                {result.questionsToAsk?.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
