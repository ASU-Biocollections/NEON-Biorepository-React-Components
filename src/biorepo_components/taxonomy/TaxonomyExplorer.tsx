import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import Cancel from '@mui/icons-material/Cancel';
import ChevronRight from '@mui/icons-material/ChevronRight';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, Link, Paper,
  Stack, Switch, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { configure } from 'col-browser/config';
import { Tree } from 'col-browser/tree';
import 'col-browser/style.css';

interface TaxonomyExplorerProps {
  apiUrl: string;
}

interface Taxon {
  tid: number;
  name: string;
  author: string | null;
  rank: string;
  status: string;
  source: string | null;
}

interface TaxonDetail extends Taxon {
  acceptedTaxon?: Taxon | null;
  acceptedLinks?: Taxon[];
  classification?: Taxon[];
  synonyms?: Taxon[];
  recordsTaxa?: string;
}

type TaxonResult = { tid: string; taxon: TaxonDetail } | { tid: string; error: string };

interface RecordPhoto {
  occid?: number | null;
  url: string;
  thumbnailUrl: string | null;
  originalUrl?: string | null;
  caption: string | null;
}

type RecordPhotoResponse = RecordPhoto & { alternates?: RecordPhoto[] };
type PhotoCandidate = { photo: RecordPhoto; src: string };
type PhotoResult = { tid: number; candidates: PhotoCandidate[] };

type TaxonCounts = { count: number; imageCount?: number };
type TaxonCountResult = { tid: number; counts: TaxonCounts };
type CachedTaxonCounts = { counts: TaxonCounts; expiresAt: number };
type RevealMode = false | 'lineage' | 'keep-open';

interface TaxonSuggestion {
  usageId: string;
  suggestion: string;
}

interface TaxonSearchProps {
  apiUrl: string;
  datasetKey: number;
  focusedName: string;
  query: string | null;
  onQueryChange: (value: string) => void;
  onSelect: (tid: string) => void;
}

const detailSectionStyle = { px: 2.5, py: 1.75 };
const taxonCountSelector = ':is(.neon-taxonomy-terminal-count, .neon-taxonomy-species-count)';
const nameStatusSelector = '.neon-taxonomy-name-status';
const scientificNameSelector = '.neon-taxonomy-scientific-name';
const taxonCountTtlMs = 60_000;
const descendantRowSelector = '[role="treeitem"]:has(.ant-tree-indent-unit)';
const caretSelector = '.catalogue-of-life .ant-tree .ant-tree-switcher-icon svg';
const branchAnimation = {
  '@keyframes neonTaxonomyBranchEnter': {
    from: { opacity: 0, transform: 'translateY(-3px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  [`& ${caretSelector}`]: { transition: 'transform 180ms ease' },
  [`& ${descendantRowSelector}`]: { animation: 'neonTaxonomyBranchEnter 160ms ease-out' },
  [`& .ant-tree-treenode-motion ${descendantRowSelector}`]: { animation: 'none' },
  '@media (prefers-reduced-motion: reduce)': {
    [`& ${caretSelector}`]: { transition: 'none' },
    '& .ant-tree-treenode-motion.ant-motion-collapse': { transitionDuration: '1ms !important' },
    [`& ${descendantRowSelector}`]: { animation: 'none' },
  },
};

function treeRowTid(row: Element) {
  const tid = row.querySelector('.ant-tree-title > [id]')?.id;
  return tid && /^[1-9]\d*$/.test(tid) ? tid : undefined;
}

function getExpandableRows(section: HTMLElement) {
  const rows = section.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]');
  return Array.from(rows).flatMap((row) => {
    if (row.closest('.ant-tree-treenode-motion')) return [];
    const switcher = row.querySelector<HTMLElement>(
      '.ant-tree-switcher:not(.ant-tree-switcher-noop)',
    );
    const key = treeRowTid(row);
    if (!switcher || !key) return [];
    return [{ key, switcher, expanded: row.getAttribute('aria-expanded') === 'true' }];
  });
}

export function configureTaxonomyExplorer(colApiUrl: string) {
  configure({ dataApi: new URL(colApiUrl, window.location.href).href });
}

function taxonLink(tid: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('tid', tid);
  return url.href;
}

function selectedTaxon() {
  const tid = new URLSearchParams(window.location.search).get('tid');
  return tid && /^[1-9]\d*$/.test(tid) ? tid : undefined;
}

function recordsOnlyFromLocation() {
  return new URLSearchParams(window.location.search).get('records') === '1';
}

function acceptedOnlyFromLocation() {
  return new URLSearchParams(window.location.search).get('accepted') === '1';
}

function recordsListLink(apiUrl: string, taxon: TaxonDetail, tab?: 'gallery') {
  const url = new URL('../../collections/list.php', new URL(apiUrl, window.location.href));
  url.searchParams.set('db', 'all,all-others');
  url.searchParams.set('taxa', taxon.recordsTaxa ?? String(taxon.tid));
  if (tab === 'gallery') url.searchParams.set('tabindex', '3');
  return url.href;
}

function TaxonSearch({ apiUrl, datasetKey, focusedName, query, onQueryChange, onSelect }: TaxonSearchProps) {
  const term = query?.trim() ?? '';
  const [result, setResult] = useState<{ url: string; options: TaxonSuggestion[] }>();
  const url = new URL(`col-api.php/dataset/${datasetKey}/nameusage/suggest`, new URL(apiUrl, window.location.href));
  url.searchParams.set('limit', '25');
  url.searchParams.set('q', term);
  const requestUrl = term ? url.href : '';

  useEffect(() => {
    if (!requestUrl) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(requestUrl, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const options: TaxonSuggestion[] = await response.json();
        if (!controller.signal.aborted) setResult({ url: requestUrl, options });
      } catch {
        // A failed suggestion request does not prevent browsing the tree.
      }
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestUrl]);

  return (
    <Autocomplete
      freeSolo
      fullWidth
      size="small"
      clearIcon={<Cancel sx={{ fontSize: 14 }} />}
      options={result?.url === requestUrl ? result.options : []}
      value={null}
      inputValue={query ?? focusedName}
      filterOptions={(options) => options}
      getOptionLabel={(option) => typeof option === 'string' ? option : option.suggestion}
      getOptionKey={(option) => typeof option === 'string' ? option : option.usageId}
      onInputChange={(_, value, reason) => {
        if (reason === 'input' || reason === 'clear') onQueryChange(value);
      }}
      onChange={(_, option) => {
        if (option && typeof option !== 'string') onSelect(option.usageId);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Find taxon"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Find taxon' },
          }}
        />
      )}
      sx={{
        mb: 1,
        '& .MuiOutlinedInput-root': { borderRadius: '6px' },
        '& .MuiAutocomplete-clearIndicator': {
          color: 'action.disabled',
          visibility: 'visible',
          '&:hover': { color: 'action.active', bgcolor: 'transparent' },
        },
      }}
    />
  );
}

export default function TaxonomyExplorer({ apiUrl }: TaxonomyExplorerProps) {
  const [recordsOnly, setRecordsOnly] = useState(recordsOnlyFromLocation);
  const [acceptedOnly, setAcceptedOnly] = useState(acceptedOnlyFromLocation);
  const [activeTid, setActiveTid] = useState(selectedTaxon);
  const [revealInTree, setRevealInTree] = useState<RevealMode>('lineage');
  const [visibilityCheck, setVisibilityCheck] = useState<{ tid: string }>();
  const [treeVisit, setTreeVisit] = useState(0);
  const [expansionPlan, setExpansionPlan] = useState<string[]>([]);
  const [result, setResult] = useState<TaxonResult | null>(null);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [photoResult, setPhotoResult] = useState<PhotoResult | null>(null);
  const [countResult, setCountResult] = useState<TaxonCountResult | null>(null);
  const treeSection = useRef<HTMLElement>(null);
  const expandedKeys = useRef(new Set<string>());
  const pendingKeys = useRef<Set<string> | null>(null);
  const restoringExpansion = useRef<string | null>(null);
  const taxonCountCache = useRef(new Map<number, CachedTaxonCounts>());

  const publicResult = result?.tid === activeTid ? result : null;
  const selected = publicResult && 'taxon' in publicResult ? publicResult.taxon : null;
  const error = publicResult && 'error' in publicResult ? publicResult.error : null;
  const detailTid = selected?.tid;
  const photoCandidate = photoResult?.tid === detailTid ? photoResult?.candidates[0] : null;
  const photo = photoCandidate?.photo;
  const counts = countResult?.tid === detailTid ? countResult?.counts : undefined;
  const { count: recordCount, imageCount } = counts ?? {};
  const hasGalleryImages = imageCount !== undefined && imageCount > 0;
  const datasetKey = (acceptedOnly ? 1 : 3) + Number(recordsOnly);

  const rememberExpansion = useCallback(() => {
    if (!treeSection.current) return;
    // Keep entries for branches hidden by the records filter or a collapsed ancestor.
    for (const { key, expanded } of getExpandableRows(treeSection.current)) {
      if (expanded) {
        expandedKeys.current.add(key);
      } else if (!pendingKeys.current?.has(key)) {
        expandedKeys.current.delete(key);
      }
    }
    setExpansionPlan([...expandedKeys.current]);
  }, []);

  useEffect(() => {
    const section = treeSection.current;
    const pending = new Set(expansionPlan);
    pendingKeys.current = pending;
    if (!section || !pending.size) return undefined;

    const attempts = new Map<string, number>();
    let frame = 0;
    let retryTimer = 0;

    function restoreNext() {
      frame = 0;
      if (!section || pending !== pendingKeys.current) return;
      if (section.querySelector('.ant-tree-treenode-motion')) return;
      for (const { key, switcher, expanded } of getExpandableRows(section)) {
        if (!pending.has(key)) continue;
        if (expanded) {
          pending.delete(key);
        } else {
          const attempt = (attempts.get(key) ?? 0) + 1;
          if (attempt > 3) {
            pending.delete(key);
            continue;
          }
          if (retryTimer) return;
          attempts.set(key, attempt);
          restoringExpansion.current = key;
          try {
            switcher.click();
          } finally {
            restoringExpansion.current = null;
          }
          // Ant can ignore clicks while it is finishing the previous branch transition.
          if (pending.has(key)) {
            retryTimer = window.setTimeout(() => {
              retryTimer = 0;
              scheduleRestore();
            }, 100);
          }
          return;
        }
      }
      if (!pending.size) observer.disconnect();
    }

    function scheduleRestore() {
      if (frame || !pending.size || pending !== pendingKeys.current) return;
      frame = window.requestAnimationFrame(restoreNext);
    }

    // CoL exposes a single initial key. Restore visible saved branches as it loads them.
    const observer = new MutationObserver(scheduleRestore);
    observer.observe(section, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'],
    });
    scheduleRestore();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
    };
  }, [expansionPlan, treeVisit]);

  const revealLineage = useCallback((taxon: TaxonDetail, keepOpen = false) => {
    // The ancestors open the path without expanding the selected taxon itself.
    const lineage = taxon.classification?.map(({ tid }) => String(tid)) ?? [];
    setExpansionPlan((open) => (keepOpen ? [...new Set([...open, ...lineage])] : lineage));
  }, []);

  const resetTree = useCallback(() => {
    setExpansionPlan([]);
    setTreeVisit((visit) => visit + 1);
  }, []);

  useEffect(() => {
    function onPopState() {
      const tid = selectedTaxon();
      const nextRecordsOnly = recordsOnlyFromLocation();
      const nextAcceptedOnly = acceptedOnlyFromLocation();
      const filterChanged = nextRecordsOnly !== recordsOnly || nextAcceptedOnly !== acceptedOnly;
      setVisibilityCheck(tid && filterChanged && (nextRecordsOnly || nextAcceptedOnly) ? { tid } : undefined);
      if (filterChanged) {
        rememberExpansion();
        setRecordsOnly(nextRecordsOnly);
        setAcceptedOnly(nextAcceptedOnly);
        setRevealInTree(false);
      }
      if (tid !== activeTid) {
        setSearchQuery(null);
        setActiveTid(tid);
        setRevealInTree(filterChanged ? false : 'lineage');
        if (!tid && !filterChanged) resetTree();
      }
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [acceptedOnly, activeTid, recordsOnly, rememberExpansion, resetTree]);

  useEffect(() => {
    if (!activeTid || !apiUrl) return undefined;
    const tid = activeTid;

    const controller = new AbortController();
    const url = new URL(apiUrl, window.location.href);
    url.searchParams.set('action', 'taxon');
    url.searchParams.set('tid', tid);
    if (!acceptedOnly) url.searchParams.set('name-mode', 'all');

    async function loadTaxon() {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status === 404) throw new Error('This taxon could not be found.');
        if (!response.ok) throw new Error('Taxon details could not be loaded.');
        const body: { data?: TaxonDetail } = await response.json();
        if (!body.data) throw new Error('Taxon details could not be loaded.');
        if (controller.signal.aborted) return;
        setResult({ tid, taxon: body.data });
        if (revealInTree) {
          revealLineage(body.data, revealInTree === 'keep-open');
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          const message = 'Taxon details could not be loaded.';
          setResult({ tid, error: reason instanceof Error ? reason.message : message });
        }
      }
    }

    loadTaxon();
    return () => controller.abort();
  }, [acceptedOnly, activeTid, apiUrl, revealInTree, revealLineage]);

  useEffect(() => {
    const checkVisibleTid = visibilityCheck?.tid;
    if (!apiUrl || (!acceptedOnly && !recordsOnly) || !checkVisibleTid || checkVisibleTid !== activeTid) {
      return undefined;
    }
    const controller = new AbortController();
    const dataset = (acceptedOnly ? 1 : 3) + Number(recordsOnly);
    const route = acceptedOnly ? 'accepted-ancestor' : 'recorded-ancestor';
    const path = `col-api.php/dataset/${dataset}/tree/${checkVisibleTid}/${route}`;
    const url = new URL(path, new URL(apiUrl, window.location.href));
    const isCurrentCheck = () => !controller.signal.aborted && selectedTaxon() === checkVisibleTid
      && acceptedOnlyFromLocation() === acceptedOnly && recordsOnlyFromLocation() === recordsOnly;

    async function findVisibleAncestor() {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const { tid }: { tid?: number | null } = await response.json();
        if (!isCurrentCheck() || tid === undefined || String(tid) === checkVisibleTid) {
          return;
        }
        const destination = new URL(window.location.href);
        if (tid === null) destination.searchParams.delete('tid');
        else destination.searchParams.set('tid', String(tid));
        window.history.replaceState(null, '', destination.href);
        setResult(null);
        setSearchQuery(null);
        setRevealInTree(tid === null ? false : 'keep-open');
        setActiveTid(tid === null ? undefined : String(tid));
      } catch {
        // The tree can still be browsed if the ancestor lookup fails.
      } finally {
        if (!controller.signal.aborted) {
          setVisibilityCheck((current) => (current === visibilityCheck ? undefined : current));
        }
      }
    }

    findVisibleAncestor();
    return () => controller.abort();
  }, [acceptedOnly, activeTid, apiUrl, recordsOnly, visibilityCheck]);

  useEffect(() => {
    if (!apiUrl || !activeTid) return undefined;
    const tid = Number(activeTid);
    const controller = new AbortController();

    async function loadRecordData<T>(action: string, onLoad: (data: T) => void) {
      const url = new URL(apiUrl, window.location.href);
      url.searchParams.set('action', action);
      url.searchParams.set('tid', String(tid));
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const { data }: { data?: T } = await response.json();
        if (!controller.signal.aborted && data !== undefined) onLoad(data);
      } catch {
        // Record data loads independently of the taxon details.
      }
    }

    loadRecordData<RecordPhotoResponse | null>('taxon-photo', (entry) => {
      const photos = entry ? [entry, ...(entry.alternates ?? [])] : [];
      const seen = new Set<string>();
      const candidates = photos.flatMap((photo) => {
        if (typeof photo.occid !== 'number' || !Number.isSafeInteger(photo.occid) || photo.occid < 1) return [];
        const urls = [photo.thumbnailUrl, photo.url, photo.originalUrl];
        return urls.flatMap((src) => {
          if (!src || seen.has(src)) return [];
          seen.add(src);
          return [{ photo, src }];
        });
      });
      setPhotoResult({ tid, candidates });
    });
    const cached = taxonCountCache.current.get(tid);
    if (cached && cached.expiresAt > Date.now()) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setCountResult({ tid, counts: cached.counts });
      });
    } else {
      loadRecordData<TaxonCounts>('taxon-records', (counts) => {
        taxonCountCache.current.set(tid, { counts, expiresAt: Date.now() + taxonCountTtlMs });
        setCountResult({ tid, counts });
      });
    }
    return () => controller.abort();
  }, [apiUrl, activeTid]);

  const changeTreeFilter = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target;
    const url = new URL(window.location.href);
    if (checked) {
      url.searchParams.set(name, '1');
    } else {
      url.searchParams.delete(name);
    }
    window.history.pushState(null, '', url.href);
    rememberExpansion();
    if (name === 'accepted') {
      setRevealInTree(false);
      setAcceptedOnly(checked);
    } else {
      setRecordsOnly(checked);
    }
    const filtering = checked || (name === 'accepted' ? recordsOnly : acceptedOnly);
    setVisibilityCheck(filtering && activeTid ? { tid: activeTid } : undefined);
  }, [acceptedOnly, activeTid, recordsOnly, rememberExpansion]);

  const handlePhotoError = useCallback(() => {
    setPhotoResult((current) => (
      current && current === photoResult
        ? { tid: current.tid, candidates: current.candidates.slice(1) }
        : current
    ));
  }, [photoResult]);

  const openTaxon = useCallback((tid: string, reveal = false) => {
    if (!/^[1-9]\d*$/.test(tid)) return;
    setSearchQuery(null);
    if (tid !== activeTid) {
      window.history.pushState(null, '', taxonLink(tid));
      setResult(null);
      setActiveTid(tid);
      setRevealInTree(reveal ? 'lineage' : false);
    } else if (reveal) {
      if (selected) revealLineage(selected);
      else setRevealInTree('lineage');
    }
  }, [activeTid, revealLineage, selected]);

  const handleTreeSelection = useCallback((tid: string | null) => {
    if (!tid) return;
    if (restoringExpansion.current === tid) {
      pendingKeys.current?.delete(tid);
      return;
    }
    openTaxon(tid);
  }, [openTaxon]);

  const selectSearchTaxon = useCallback((tid: string) => openTaxon(tid, true), [openTaxon]);

  const taxonProfileLink = useCallback((tid: string) => {
    const api = new URL(apiUrl, window.location.href);
    const url = new URL('../../taxa/index.php', api);
    url.searchParams.set('tid', tid);
    return url.href;
  }, [apiUrl]);

  const openTreeRow = useCallback((row: Element) => {
    const tid = treeRowTid(row);
    if (tid) openTaxon(tid);
  }, [openTaxon]);

  const selectTreeRow = useCallback((event: MouseEvent<HTMLElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified) return;
    const { target } = event;
    if (!(target instanceof Element)) return;
    if (target.closest('a[href], button, [role="button"]')) return;
    if (target.closest('.ant-tree-switcher:not(.ant-tree-switcher-noop)')) return;
    const row = target.closest('[role="treeitem"]');
    if (row) openTreeRow(row);
  }, [openTreeRow]);

  const selectTreeRowFromKeyboard = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== ' ' || !(event.target instanceof Element)) return;
    if (!event.target.matches('[role="tree"]')) return;
    const rowId = event.target.getAttribute('aria-activedescendant');
    const row = rowId ? document.getElementById(rowId) : null;
    if (row && event.target.contains(row)) openTreeRow(row);
  }, [openTreeRow]);

  function followTaxonLink(event: MouseEvent<HTMLAnchorElement>, tid: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openTaxon(tid, true);
  }

  function detailLink(taxon: Taxon) {
    const tid = String(taxon.tid);
    return (
      <Link
        href={taxonLink(tid)}
        onClick={(event) => followTaxonLink(event, tid)}
        underline="hover"
        sx={{ overflowWrap: 'anywhere' }}
      >
        {taxon.name}
      </Link>
    );
  }

  if (!apiUrl) {
    return <Alert severity="error">The taxonomy explorer is unavailable.</Alert>;
  }

  const primaryAccepted = selected?.acceptedTaxon;
  const acceptedNames = new Map<number, Taxon>();
  if (primaryAccepted) acceptedNames.set(primaryAccepted.tid, primaryAccepted);
  selected?.acceptedLinks?.forEach((taxon) => acceptedNames.set(taxon.tid, taxon));
  const otherSynonyms = selected?.synonyms?.filter((taxon) => taxon.tid !== selected.tid) ?? [];
  const activeRow = activeTid ? `[role="treeitem"]:has(.ant-tree-title > [id="${activeTid}"])` : '';
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(16rem, 22rem)' },
      alignItems: 'start',
      gap: 3,
    }}
    >
      <Box
        component="section"
        ref={treeSection}
        aria-label="Taxonomy tree"
        onClickCapture={selectTreeRow}
        onKeyDownCapture={selectTreeRowFromKeyboard}
        sx={{
          ...branchAnimation,
          minWidth: 0,
          overflowX: 'auto',
          // CoL ties its built-in search value to tree expansion.
          '& .catalogue-of-life .taxon-autocomplete': { display: 'none' },
          '& .ant-tree-treenode': { alignSelf: 'stretch' },
          '& .ant-tree-node-content-wrapper': { cursor: 'pointer', flex: 1 },
          '& .ant-tree .ant-tree-node-content-wrapper.ant-tree-node-selected:not(:hover)': {
            backgroundColor: 'transparent',
          },
          ...(activeRow && {
            [`& .ant-tree ${activeRow} .ant-tree-node-content-wrapper`]: {
              backgroundColor: (theme: Theme) => alpha(theme.palette.primary.main, 0.13),
            },
          }),
          [`& ${scientificNameSelector}`]: { color: 'primary.main' },
          [`& ${taxonCountSelector}`]: { color: 'text.primary', whiteSpace: 'nowrap' },
          [`& ${nameStatusSelector}`]: { color: 'text.secondary', whiteSpace: 'nowrap' },
        }}
      >
        <Stack direction="row" sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.25,
          mb: 1,
          '& .MuiFormControlLabel-root': { m: 0, minHeight: 32, columnGap: 0.5 },
          '& .MuiFormControlLabel-label': { typography: 'body2' },
        }}>
          <FormControlLabel
            label="Hide synonyms"
            control={(
              <Switch
                name="accepted"
                color="primary"
                size="small"
                checked={acceptedOnly}
                onChange={changeTreeFilter}
                slotProps={{ input: { role: 'switch' } }}
              />
            )}
          />
          <FormControlLabel
            label="Hide taxa without records"
            control={(
              <Switch
                name="records"
                color="primary"
                size="small"
                checked={recordsOnly}
                onChange={changeTreeFilter}
                slotProps={{ input: { role: 'switch' } }}
              />
            )}
          />
        </Stack>
        <TaxonSearch
          apiUrl={apiUrl}
          datasetKey={datasetKey}
          focusedName={selected?.name ?? ''}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelect={selectSearchTaxon}
        />
        <Tree
          key={`${datasetKey}-${treeVisit}`}
          datasetKey={datasetKey}
          autoFocus={false}
          insertPlaceholder={false}
          onExpandedTaxonKeyChange={handleTreeSelection}
        />
      </Box>
      {activeTid && (
        <Paper
          component="section"
          aria-label="Taxon details"
          aria-busy={!error && !selected}
          variant="outlined"
          sx={{ borderRadius: 2, minWidth: 0, overflow: 'hidden' }}
        >
          {error && <Alert severity="error">{error}</Alert>}
          {!error && !selected && (
            <Box sx={detailSectionStyle}>
              <CircularProgress size={20} aria-label="Loading taxon details" />
            </Box>
          )}
          {selected && (
            <Stack divider={<Divider flexItem />}>
              <Box sx={{
                ...detailSectionStyle,
                py: 2,
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05),
              }}
              >
                <Typography
                  variant="h5"
                  component="h2"
                  sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                >
                  {selected.name}
                </Typography>
                {selected.author && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {selected.author}
                  </Typography>
                )}
                {(selected.rank || selected.status) && (
                  <Stack
                    direction="row"
                    sx={{
                      mt: 1.25, alignItems: 'center', gap: 1, flexWrap: 'wrap',
                    }}
                  >
                    {selected.rank && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ textTransform: 'capitalize' }}
                      >
                        {selected.rank}
                      </Typography>
                    )}
                    {selected.status && (
                      <Chip
                        label={selected.status}
                        color={selected.status === 'accepted' ? 'success' : 'default'}
                        variant="outlined"
                        size="small"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    )}
                  </Stack>
                )}
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Button
                    href={taxonProfileLink(String(selected.tid))}
                    variant="contained"
                    size="medium"
                    fullWidth
                    endIcon={<ChevronRight />}
                  >
                    View Taxon Profile
                  </Button>
                  <Button
                    href={recordCount === 0 ? undefined : recordsListLink(apiUrl, selected)}
                    disabled={recordCount === 0}
                    variant="contained"
                    size="medium"
                    fullWidth
                    endIcon={<FormatListBulleted />}
                  >
                    Browse {recordCount !== undefined && `${recordCount.toLocaleString()} `}
                    {recordCount === 1 ? 'Record' : 'Records'}
                  </Button>
                </Stack>
              </Box>
              {(photo || hasGalleryImages) && (
                <Box component={photo ? 'figure' : 'div'} sx={{ ...detailSectionStyle, m: 0 }}>
                  {photo && photoCandidate && (
                    <>
                      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                        Image
                      </Typography>
                      <Box
                        component="img"
                        key={photoCandidate.src}
                        src={photoCandidate.src}
                        alt={photo.caption || 'Photo from a specimen record'}
                        onError={handlePhotoError}
                        sx={{
                          display: 'block',
                          width: '100%',
                          maxHeight: 224,
                          objectFit: 'contain',
                          borderRadius: 1,
                        }}
                      />
                    </>
                  )}
                  <Button
                    href={imageCount === 0 ? undefined : recordsListLink(apiUrl, selected, 'gallery')}
                    disabled={imageCount === 0}
                    variant="outlined"
                    size="medium"
                    fullWidth
                    endIcon={<ImageOutlined />}
                    sx={{ mt: photo ? 2 : 0 }}
                  >
                    Browse {imageCount !== undefined && `${imageCount.toLocaleString()} `}
                    {imageCount === 1 ? 'Image' : 'Images'}
                  </Button>
                </Box>
              )}
              {acceptedNames.size > 0 && (
                <Box sx={detailSectionStyle}>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 0.75 }}>
                    Accepted Name(s)
                  </Typography>
                  <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {Array.from(acceptedNames.values(), (taxon) => (
                      <Typography component="li" variant="body2" key={taxon.tid}>
                        {detailLink(taxon)}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              )}
              {otherSynonyms.length > 0 && (
                <Box sx={detailSectionStyle}>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 0.75 }}>
                    Synonym(s)
                  </Typography>
                  <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {otherSynonyms.map((synonym) => (
                      <Typography component="li" variant="body2" key={synonym.tid}>
                        {detailLink(synonym)}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              )}
              {!!selected.classification?.length && (
                <Box component="nav" aria-label="Taxon classification" sx={detailSectionStyle}>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                    Classification
                  </Typography>
                  <Stack
                    component="ol"
                    spacing={0.65}
                    sx={{
                      listStyle: 'none', m: 0, pl: 1.5, borderLeft: 2, borderColor: 'divider',
                    }}
                  >
                    {selected.classification.map((ancestor) => (
                      <Stack
                        key={ancestor.tid}
                        component="li"
                        direction="row"
                        sx={{ alignItems: 'baseline', gap: 1 }}
                      >
                        <Typography variant="body2" component="span">
                          {detailLink(ancestor)}
                        </Typography>
                        {ancestor.rank && (
                          <Typography variant="caption" color="text.secondary">
                            {ancestor.rank}
                          </Typography>
                        )}
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              )}
              {selected.source && (
                <Box sx={detailSectionStyle}>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
                    Source
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {selected.source}
                  </Typography>
                </Box>
              )}
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}
