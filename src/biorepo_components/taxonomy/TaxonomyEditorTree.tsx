'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Cancel from '@mui/icons-material/Cancel';
import { Autocomplete, Box, TextField } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { messageFor } from './TaxonomyEditorApi';
import type { EditorNode, Page } from './TaxonomyEditorApi';
import styles from './TaxonomyEditor.module.css';
import sourceStyles from './TaxonomyEditorSourceTree.module.css';

const pageSize = 50;
const italicRanks = new Set([
  'genus', 'subgenus', 'section', 'subsection', 'species', 'subspecies',
  'variety', 'subvariety', 'form', 'subform',
]);

type NodeId = EditorNode['id'];

interface TreeProps {
  loadChildren: (parent: NodeId | null, offset: number, limit: number) => Promise<Page<EditorNode>>;
  loadLineage: (id: NodeId) => Promise<EditorNode[]>;
  search: (query: string, offset: number, limit: number, signal?: AbortSignal) => Promise<Page<EditorNode>>;
  selected: NodeId | undefined;
  selectedName?: string;
  onSelect: (node: EditorNode) => void;
}

interface BranchPage extends Page<EditorNode> {
  offset: number;
}

interface Branch {
  page?: BranchPage;
  loading?: boolean;
  error?: string;
}

interface SearchResult {
  term: string;
  items: EditorNode[];
  error?: string;
}

export function TaxonName({
  node, italicize = false, scientificNameClass, rankSeparator = '',
}: { node: EditorNode; italicize?: boolean; scientificNameClass?: string; rankSeparator?: string }) {
  return (
    <>
      {node.rank && (
        <span className={styles.rank}>
          {node.rank}
          {rankSeparator}
          {' '}
        </span>
      )}
      {italicize && italicRanks.has(node.rank?.toLowerCase() ?? '')
        ? <i className={scientificNameClass}>{node.name}</i>
        : <span className={scientificNameClass}>{node.name}</span>}
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

function branchKey(parent: NodeId | null) {
  return parent === null ? 'root' : `taxon:${parent}`;
}

function nameForOption(node: EditorNode) {
  return [node.name, node.author].filter(Boolean).join(' ');
}

function scrollToSelected(root: HTMLDivElement | null) {
  const selected = root?.querySelector('button[aria-pressed="true"]');
  if (!root || !selected) return;
  const pane = root.getBoundingClientRect();
  const row = selected.getBoundingClientRect();
  if (row.top < pane.top) root.scrollTop += row.top - pane.top;
  else if (row.bottom > pane.bottom) root.scrollTop += row.bottom - pane.bottom;
}

export default function TaxonomyEditorTree({
  loadChildren,
  loadLineage,
  search,
  selected,
  selectedName,
  onSelect,
}: TreeProps) {
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const branchCache = useRef<Record<string, Branch>>({});
  const pendingPages = useRef(new Map<string, Promise<BranchPage | undefined>>());
  const generation = useRef(0);
  const [open, setOpen] = useState<Set<NodeId>>(new Set());
  const [extraNodes, setExtraNodes] = useState<Record<string, EditorNode>>({});
  const [selectedNode, setSelectedNode] = useState<EditorNode>();
  const [query, setQuery] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult>();
  const [revealAttempt, setRevealAttempt] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const revealSequence = useRef(0);
  const tree = useRef<HTMLDivElement>(null);
  const term = query?.trim() ?? '';
  const matching = result?.term === term ? result : undefined;
  const focusedName = selectedName ?? (selectedNode?.id === selected ? selectedNode?.name : undefined) ?? '';

  const setBranch = useCallback((key: string, branch: Branch) => {
    const next = { ...branchCache.current, [key]: branch };
    branchCache.current = next;
    setBranches(next);
  }, []);

  const loadPage = useCallback((parent: NodeId | null) => {
    const key = branchKey(parent);
    const pending = pendingPages.current.get(key);
    if (pending) return pending;
    const previous = branchCache.current[key]?.page;
    const offset = previous?.offset ?? 0;
    const currentGeneration = generation.current;
    setBranch(key, { page: previous, loading: true });
    const request = Promise.resolve().then(() => loadChildren(parent, offset, pageSize))
      .then((page) => {
        if (currentGeneration !== generation.current) return undefined;
        const items = new Map((previous?.items ?? []).map((node) => [node.id, node]));
        page.items.forEach((node) => items.set(node.id, node));
        const next = {
          items: [...items.values()],
          total: page.total,
          offset: page.items.length ? offset + page.items.length : page.total,
        };
        setBranch(key, { page: next });
        return next;
      })
      .catch((error) => {
        if (currentGeneration === generation.current) {
          setBranch(key, { page: previous, error: messageFor(error) });
        }
        return undefined;
      })
      .finally(() => {
        if (currentGeneration === generation.current) pendingPages.current.delete(key);
      });
    pendingPages.current.set(key, request);
    return request;
  }, [loadChildren, setBranch]);

  useEffect(() => {
    void loadPage(null);
    return () => {
      generation.current += 1;
      pendingPages.current.clear();
      branchCache.current = {};
    };
  }, [loadPage]);

  useEffect(() => {
    if (term.length < 2) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const page = await search(term, 0, pageSize, controller.signal);
        if (!controller.signal.aborted) setResult({ term, items: page.items });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ term, items: [], error: messageFor(error) });
        }
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, term]);

  useEffect(() => {
    setQuery(null);
  }, [selected]);

  useEffect(() => {
    if (selected === undefined) {
      setExtraNodes({});
      setRevealError('');
      setRevealing(false);
      return undefined;
    }
    const current = ++revealSequence.current;
    const isCurrent = () => current === revealSequence.current;
    const id = selected;
    const target = tree.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');

    setRevealError('');
    if (target && target.dataset.taxonId === String(id)) {
      setRevealing(false);
      return undefined;
    }

    async function reveal() {
      setRevealing(true);
      try {
        const lineage = await loadLineage(id);
        const node = lineage.at(-1);
        if (!isCurrent()) return;
        if (!node || node.id !== id) throw new Error('This name could not be located in the source tree.');
        setSelectedNode(node);
        const additions: Record<string, EditorNode> = {};
        let parent: NodeId | null = null;
        for (const ancestor of lineage) {
          const key = branchKey(parent);
          let page = branchCache.current[key]?.page ?? await loadPage(parent);
          if (!isCurrent()) return;
          if (!page) throw new Error('The selected branch could not be loaded.');
          // Source child lists omit synonyms. Add a selected synonym from its authoritative path.
          if (!ancestor.status?.toLowerCase().includes('synonym')) {
            while (!page.items.some((entry) => entry.id === ancestor.id) && page.offset < page.total) {
              page = await loadPage(parent);
              if (!isCurrent()) return;
              if (!page) throw new Error('The selected branch could not be loaded.');
            }
          }
          if (!page.items.some((entry) => entry.id === ancestor.id)) additions[key] = ancestor;
          parent = ancestor.id;
        }
        setExtraNodes(additions);
        setOpen((branchesOpen) => new Set([...branchesOpen, ...lineage.slice(0, -1).map(({ id: key }) => key)]));
      } catch (error) {
        if (isCurrent()) setRevealError(messageFor(error));
      } finally {
        if (isCurrent()) setRevealing(false);
      }
    }

    void reveal();
    return () => {
      revealSequence.current += 1;
    };
  }, [loadLineage, loadPage, revealAttempt, selected]);

  useEffect(() => {
    if (!revealing) scrollToSelected(tree.current);
  }, [revealing, selected]);

  function selectNode(node: EditorNode) {
    setSelectedNode(node);
    setQuery(null);
    if (node.id === selected) setRevealAttempt((count) => count + 1);
    onSelect(node);
  }

  function toggle(node: EditorNode) {
    const key = branchKey(node.id);
    if (open.has(node.id)) {
      // An explicit collapse takes precedence over a search reveal still in progress.
      revealSequence.current += 1;
      setRevealing(false);
      setOpen((current) => new Set([...current].filter((id) => id !== node.id)));
    } else {
      setOpen((current) => new Set([...current, node.id]));
      if (!branchCache.current[key]?.page) void loadPage(node.id);
    }
  }

  function renderNodes(parent: NodeId | null, ancestors: ReadonlySet<NodeId> = new Set()): ReactNode {
    const key = branchKey(parent);
    const branch = branches[key];
    const page = branch?.page;
    if (!page && !branch?.error) return <div className={styles.muted} role="status">Loading…</div>;

    const extra = extraNodes[key];
    const items = page?.items ?? [];
    const nodes = extra && !items.some(({ id }) => id === extra.id) ? [...items, extra] : items;
    return (
      <>
        {branch?.error && <p className={styles.error} role="alert">{branch.error}</p>}
        {!!nodes.length && (
          <ul className={sourceStyles.list}>
            {nodes.filter(({ id }) => !ancestors.has(id)).map((node) => (
              <li key={node.id}>
                <div className={sourceStyles.row}>
                  {node.hasChildren || open.has(node.id) ? (
                    <button
                      type="button"
                      className={sourceStyles.caretButton}
                      aria-expanded={open.has(node.id)}
                      aria-label={`${open.has(node.id) ? 'Collapse' : 'Expand'} ${node.name}`}
                      onClick={() => toggle(node)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 10 10" className={sourceStyles.caret}>
                        <path d="M3 2L7 5L3 8Z" fill="currentColor" />
                      </svg>
                    </button>
                  ) : <span className={sourceStyles.spacer} />}
                  <button
                    type="button"
                    className={sourceStyles.nameButton}
                    data-taxon-id={node.id}
                    aria-pressed={selected === node.id}
                    onClick={() => selectNode(node)}
                  >
                    <TaxonName node={node} italicize scientificNameClass={sourceStyles.scientificName} rankSeparator=":" />
                  </button>
                </div>
                {open.has(node.id) && (
                  <div className={sourceStyles.branch}>
                    {renderNodes(node.id, new Set([...ancestors, node.id]))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {page && !nodes.length && !branch?.error && <p className={styles.muted}>No taxa to display.</p>}
        {(branch?.error || (page && page.offset < page.total)) && (
          <button
            type="button"
            className={styles.button}
            disabled={branch?.loading}
            onClick={() => void loadPage(parent)}
          >
            {branch?.loading ? 'Loading…' : branch?.error ? 'Retry' : 'More names'}
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <Autocomplete
        freeSolo
        fullWidth
        size="small"
        clearText="Clear source taxon search"
        clearIcon={<Cancel sx={{ fontSize: 14 }} />}
        options={matching?.items ?? []}
        value={null}
        inputValue={query ?? focusedName}
        filterOptions={(options) => options}
        getOptionLabel={(option) => typeof option === 'string' ? option : nameForOption(option)}
        getOptionKey={(option) => typeof option === 'string' ? option : option.id}
        onInputChange={(_, value, reason) => {
          if (reason === 'input' || reason === 'clear') setQuery(value);
        }}
        onChange={(_, option) => {
          if (option && typeof option !== 'string') selectNode(option);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Find taxon"
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Find a source taxon' },
            }}
          />
        )}
        sx={{
          '& .MuiAutocomplete-clearIndicator': {
            visibility: 'visible',
            color: 'action.disabled',
            '&:hover': { color: 'action.active', bgcolor: 'transparent' },
          },
        }}
      />
      {term.length >= 2 && (matching
        ? matching.error
          ? <p className={styles.error} role="alert">{matching.error}</p>
          : !matching.items.length && <p className={styles.muted} role="status">No matching taxa.</p>
        : <p className={styles.muted} role="status">Searching…</p>)}
      {revealError && <p className={styles.error} role="alert">{revealError}</p>}
      <Box
        ref={tree}
        className={sourceStyles.viewport}
        aria-busy={revealing || branches.root?.loading}
        sx={(theme) => ({
          '--source-tree-primary': theme.palette.primary.main,
          '--source-tree-selection': alpha(theme.palette.primary.main, 0.13),
          '--source-tree-text': theme.palette.text.primary,
          '--source-tree-rank': alpha(theme.palette.text.primary, 0.45),
          '--source-tree-hover': theme.palette.action.hover,
          [`& .${styles.rank}`]: { color: 'var(--source-tree-rank)', fontSize: 'inherit' },
        })}
      >
        {renderNodes(null)}
      </Box>
    </>
  );
}
