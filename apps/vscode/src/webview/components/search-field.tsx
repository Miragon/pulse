import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icon.js';
import { glyphs } from './lucide-glyphs.json';

const SEARCH_DELAY_MS = 400;

export interface SearchFieldProps {
  readonly applied: string;
  readonly label: string;
  readonly placeholder: string;
  readonly onSearch: (text: string) => void;
}

function useSearch({ applied, onSearch }: SearchFieldProps) {
  const [text, setText] = useState(applied);
  const requested = useRef(applied);
  const latest = useRef(onSearch);
  latest.current = onSearch;

  useEffect(() => {
    if (applied !== requested.current) {
      requested.current = applied;
      setText(applied);
    }
  }, [applied]);

  useEffect(() => {
    const wanted = text.trim();
    if (wanted === requested.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      requested.current = wanted;
      latest.current(wanted);
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text]);
  return { text, setText };
}

export function SearchField(props: SearchFieldProps) {
  const search = useSearch(props);
  return (
    <label class="search-field">
      <Icon of={glyphs.Search} />
      <span class="visually-hidden">{props.label}</span>
      <input
        type="search"
        value={search.text}
        placeholder={props.placeholder}
        onInput={(event) => {
          search.setText(event.currentTarget.value);
        }}
      />
    </label>
  );
}
