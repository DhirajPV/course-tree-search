import { useId, useRef, useState, type SubmitEvent } from 'react';
import type { SearchClient } from './client';
import { SearchResults, messages } from './SearchResults';
import { useCourseSearch } from './useCourseSearch';

export function CourseSearch({ client }: { client: SearchClient }) {
  const { state, search, retry } = useCourseSearch(client);
  const [term, setTerm] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const query = term.trim();

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query !== '') search(query);
  }

  // Try again unmounts with the alert, which would drop focus to the body.
  // Waiting and changing the term both start at the input, so focus goes there.
  function handleRetry() {
    retry();
    inputRef.current?.focus();
  }

  return (
    <>
      <form className="search-form" role="search" onSubmit={handleSubmit}>
        <label htmlFor={inputId}>{messages.searchLabel}</label>
        <div className="search-controls">
          <input
            id={inputId}
            ref={inputRef}
            type="search"
            name="query"
            value={term}
            placeholder={messages.searchPlaceholder}
            onChange={(event) => setTerm(event.target.value)}
          />
          <button type="submit" disabled={query === ''}>
            {messages.searchButton}
          </button>
        </div>
      </form>
      <SearchResults state={state} onRetry={handleRetry} />
    </>
  );
}
