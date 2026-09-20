import { useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversation, setConversation] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError('');
    const clientMessage = input.trim();
    setConversation((current) => [...current, { role: 'user', content: clientMessage }]);
    setInput('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientInput: clientMessage }),
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

        setError(data.details || data.message || data.error || fallbackMessage);
      } else {
        setConversation((current) => [...current, { role: 'assistant', content: data }]);
      }
    } catch (err) {
      setError('Could not reach the server. Is it running on port 5000?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>GigBrief</h1>
      </header>
      <main className="conversation">
        {conversation.length === 0 && <section className="welcome">
          <h2>Paste your client's vague gig request</h2>
        </section>}
        {conversation.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
          <div className="message-body">
            {message.role === 'user' ? <p className="user-copy">{message.content}</p> : <Analysis result={message.content} />}
          </div>
        </div>)}
        {loading && <div className="loading"><span /><span /><span /> Building your MVP direction...</div>}
        {error && <div className="error">{error}</div>}
      </main>
      <form className="composer" onSubmit={handleSubmit}>
        <textarea rows={1} placeholder="Ask anything about your client's request" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }} />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Analyze requirement">{loading ? '...' : '↑'}</button>
      </form>
    </div>
  );
}

function Analysis({ result }) {
  const list = (items) => <ul>{items?.map((item, index) => <li key={index}>{item}</li>)}</ul>;
  return <article className="analysis">
    <div className="analysis-intro"><p className="eyebrow">{result.projectTitle || 'Project direction'}</p><h2>{result.oneLiner}</h2><p>{result.problem}</p></div>
    <div className="analysis-grid">
      <section className="analysis-section featured"><h3>Recommended MVP</h3>{list(result.mvp)}</section>
      <section className="analysis-section"><h3>Core user flow</h3>{list(result.userFlow)}</section>
      <section className="analysis-section architecture"><h3>Closest-fit architecture</h3><p>{result.architecture?.recommendation}</p><dl><dt>Frontend</dt><dd>{result.architecture?.frontend}</dd><dt>Backend</dt><dd>{result.architecture?.backend}</dd><dt>Data</dt><dd>{result.architecture?.data}</dd></dl>{list(result.architecture?.integrations)}</section>
      <section className="analysis-section"><h3>Delivery path</h3>{list(result.deliveryPlan)}</section>
      <section className="analysis-section caution"><h3>Questions before quoting</h3>{list(result.questionsToAsk)}</section>
      <section className="analysis-section"><h3>Defer for later</h3>{list(result.outOfScope)}</section>
    </div>
    <div className="assumptions"><strong>Working assumptions</strong>{list(result.assumptions)}</div>
  </article>;
}

export default App;
