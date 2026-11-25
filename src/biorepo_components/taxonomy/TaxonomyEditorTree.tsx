'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { SubmitEvent, ReactNode } from 'react';
import { messageFor } from './TaxonomyEditorApi';
import type { EditorNode, Page } from './TaxonomyEditorApi';
import styles from './TaxonomyEditor.module.css';

const PAGE_SIZE = 50;

interface TreeProps<T extends EditorNode> {
  title: string;
  actions?: ReactNode;
  loadChildren: (parent: T['id'] | null, offset: number, limit: number) => Promise<Page<T>>;
  search: (query: string, offset: number, limit: number) => Promise<Page<T>>;
  selected: T['id'] | undefined;
  onSelect: (node: T) => void;
}

export function TaxonName({ node }: { node: EditorNode }) {
  return (
    <>
      {node.rank && (
        <span className={styles.rank}>
          {node.rank}
          {' '}
        </span>
      )}
      <span>{node.name}</span>
      {node.author && (
        <span className={styles.author}>
          {' '}
          {node.author}
        </span>
      )}
      {node.status === 'synonym' && <span className={styles.synonym}>Synonym</span>}
    </>
  );
}

function branchKey(parent: string | number | null) {
  return parent === null ? 'root' : `taxon:${parent}`;
}

export default function TaxonomyEditorTree<T extends EditorNode>({
  title,
  actions,
  loadChildren,
  search,
  selected,
  onSelect,
}: TreeProps<T>) {
  const [pages, setPages] = useState<Record<string, Page<T>>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({ root: true });
  const [open, setOpen] = useState<Set<T['id']>>(new Set());
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<Page<T>>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (parent: T['id'] | null, offset = 0) => {
      const key = branchKey(parent);
      setLoading((previous) => ({ ...previous, [key]: true }));
      setError('');
      try {
        const response = await loadChildren(parent, offset, PAGE_SIZE);
        setPages((previous) => ({
          ...previous,
          [key]: {
            total: response.total,
            items: offset
              ? [...(previous[key]?.items ?? []), ...response.items]
              : response.items,
          },
        }));
      } catch (err) {
        setError(messageFor(err));
      } finally {
        setLoading((previous) => ({ ...previous, [key]: false }));
      }
    },
    [loadChildren],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) load(null); });
    return () => { active = false; };
  }, [load]);

  function toggle(node: T) {
    const next = new Set(open);
    if (next.has(node.id)) next.delete(node.id);
    else {
      next.add(node.id);
      if (!pages[branchKey(node.id)] && !loading[branchKey(node.id)]) load(node.id);
    }
    setOpen(next);
  }

  async function searchNames(text: string, offset = 0) {
    const value = text.trim();
    if (!value) {
      setSearched('');
      setResults(undefined);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const response = await search(value, offset, PAGE_SIZE);
      setSearched(value);
      setResults((previous) => ({
        total: response.total,
        items: offset ? [...(previous?.items ?? []), ...response.items] : response.items,
      }));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSearching(false);
    }
  }

  function submitSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    searchNames(query);
  }

  function renderNodes(
    parent: T['id'] | null,
    ancestors: ReadonlySet<T['id']> = new Set(),
  ): ReactNode {
    const key = branchKey(parent);
    const page = pages[key];
    const isLoading = loading[key];

    if (!page) {
      return isLoading ? (
        <div className={styles.muted} role="status">
          Loading…
        </div>
      ) : (
        <button type="button" className={styles.button} onClick={() => load(parent)}>
          Reload names
        </button>
      );
    }
    if (!page.items.length) return <div className={styles.muted}>No taxa to display.</div>;

    return (
      <ul className={styles.treeList}>
        {page.items
          .filter((node) => !ancestors.has(node.id))
          .map((node) => (
            <li key={node.id}>
              <div className={styles.treeRow}>
                {node.hasChildren ? (
                  <button
                    type="button"
                    className={styles.expand}
                    aria-expanded={open.has(node.id)}
                    aria-label={`${open.has(node.id) ? 'Collapse' : 'Expand'} ${node.name}`}
                    onClick={() => toggle(node)}
                  >
                    <span aria-hidden="true">{open.has(node.id) ? '▾' : '▸'}</span>
                  </button>
                ) : (
                  <span className={styles.treeSpacer} />
                )}
                <button
                  type="button"
                  className={styles.nameButton}
                  aria-pressed={selected === node.id}
                  onClick={() => onSelect(node)}
                >
                  <TaxonName node={node} />
                </button>
              </div>
              {node.hasChildren && open.has(node.id) && (
                <div className={styles.branch}>
                  {renderNodes(node.id, new Set([...ancestors, node.id]))}
                </div>
              )}
            </li>
          ))}
        {page.items.length < page.total && (
          <li>
            <button
              type="button"
              className={styles.button}
              disabled={isLoading}
              onClick={() => load(parent, page.items.length)}
            >
              {isLoading ? 'Loading…' : 'More names'}
            </button>
          </li>
        )}
      </ul>
    );
  }

  function renderResults(page: Page<T>) {
    if (!page.items.length) return <p className={styles.muted}>No names found.</p>;
    return (
      <ul className={styles.treeList}>
        {page.items.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className={styles.nameButton}
              aria-pressed={selected === node.id}
              onClick={() => onSelect(node)}
            >
              <TaxonName node={node} />
            </button>
          </li>
        ))}
        {page.items.length < page.total && (
          <li>
            <button
              type="button"
              className={styles.button}
              disabled={searching}
              onClick={() => searchNames(searched, page.items.length)}
            >
              {searching ? 'Searching…' : 'More results'}
            </button>
          </li>
        )}
      </ul>
    );
  }

  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        <div className={styles.actions}>{actions}</div>
      </div>
      <form className={styles.search} onSubmit={submitSearch}>
        <input
          type="search"
          placeholder="Find a taxon"
          aria-label={`Find a taxon in ${title}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className={styles.button} disabled={searching}>
          Search
        </button>
        {results && (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setQuery('');
              setSearched('');
              setResults(undefined);
            }}
            disabled={searching}
          >
            Back to tree
          </button>
        )}
      </form>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.treeScroll} aria-busy={searching || loading.root}>
        {results ? renderResults(results) : renderNodes(null)}
      </div>
    </section>
  );
}
