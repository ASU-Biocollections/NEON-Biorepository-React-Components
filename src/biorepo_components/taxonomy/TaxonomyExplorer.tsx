import React, { useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Alert, Box, CircularProgress, Link, Stack, Typography,
} from '@mui/material';
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
  classification?: Taxon[];
  synonyms?: Taxon[];
}

type TaxonResult = { tid: string; taxon: TaxonDetail } | { tid: string; error: string };

export function configureTaxonomyExplorer(colApiUrl: string) {
  configure({ dataApi: new URL(colApiUrl, window.location.href).href });
}

function taxonLink(tid?: string) {
  const url = new URL(window.location.href);
  if (tid) {
    url.searchParams.set('tid', tid);
  } else {
    url.searchParams.delete('tid');
  }
  return url.href;
}

function selectedTaxon() {
  const tid = new URLSearchParams(window.location.search).get('tid');
  return tid && /^[1-9]\d*$/.test(tid) ? tid : undefined;
}

export default function TaxonomyExplorer({ apiUrl }: TaxonomyExplorerProps) {
  const [activeTid, setActiveTid] = useState(selectedTaxon);
  const [revealInTree, setRevealInTree] = useState(true);
  const [expandedTid, setExpandedTid] = useState<string>();
  const [treeVisit, setTreeVisit] = useState(0);
  const [result, setResult] = useState<TaxonResult | null>(null);

  const publicResult = result?.tid === activeTid ? result : null;
  const selected = publicResult && 'taxon' in publicResult ? publicResult.taxon : null;
  const error = publicResult && 'error' in publicResult ? publicResult.error : null;

  const expandToTaxon = useCallback((tid: string | undefined) => {
    setExpandedTid(tid);
    // The tree applies a host-driven expansion when it loads.
    setTreeVisit((visit) => visit + 1);
  }, []);

  useEffect(() => {
    function onPopState() {
      const tid = selectedTaxon();
      setActiveTid(tid);
      setRevealInTree(true);
      if (!tid) expandToTaxon(undefined);
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [expandToTaxon]);

  useEffect(() => {
    if (!activeTid || !apiUrl) return undefined;
    const tid = activeTid;

    const controller = new AbortController();
    const url = new URL(apiUrl, window.location.href);
    url.searchParams.set('action', 'taxon');
    url.searchParams.set('tid', tid);

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
          expandToTaxon(String(body.data.acceptedTaxon?.tid ?? body.data.tid));
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
  }, [activeTid, apiUrl, expandToTaxon, revealInTree]);

  const openTaxon = useCallback((tid: string, reveal = false) => {
    if (!/^[1-9]\d*$/.test(tid)) return;
    if (tid !== activeTid) {
      window.history.pushState(null, '', taxonLink(tid));
      setResult(null);
      setActiveTid(tid);
      setRevealInTree(reveal);
    } else if (reveal && selected) {
      expandToTaxon(String(selected.acceptedTaxon?.tid ?? selected.tid));
    }
  }, [activeTid, expandToTaxon, selected]);

  const revealTaxon = useCallback((tid: string | null) => {
    setExpandedTid(tid ?? undefined);
    if (tid) openTaxon(tid);
  }, [openTaxon]);

  function followTaxonLink(event: MouseEvent<HTMLAnchorElement>, tid: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openTaxon(tid, true);
  }

  if (!apiUrl) {
    return <Alert severity="error">The taxonomy explorer is unavailable.</Alert>;
  }

  const acceptedTaxon = selected?.acceptedTaxon;
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 3fr) minmax(16rem, 2fr)' },
      gap: 3,
    }}
    >
      <Box component="section" aria-label="Taxonomy tree" sx={{ minWidth: 0, overflowX: 'auto' }}>
        <Tree
          key={treeVisit}
          datasetKey={1}
          autoFocus={false}
          insertPlaceholder={false}
          defaultTaxonKey={expandedTid}
          onExpandedTaxonKeyChange={revealTaxon}
          hrefForTaxon={taxonLink}
          onNavigateToTaxon={openTaxon}
        />
      </Box>
      <Stack component="section" aria-label="Taxon details" spacing={1.5} sx={{ minWidth: 0 }}>
        {activeTid && error && <Alert severity="error">{error}</Alert>}
        {activeTid && !error && !selected && (
          <CircularProgress size={20} aria-label="Loading taxon details" />
        )}
        {selected && (
          <>
            <Typography variant="h5" component="h2">{selected.name}</Typography>
            {selected.author && <Typography>{selected.author}</Typography>}
            <Typography>{[selected.rank, selected.status].filter(Boolean).join(' · ')}</Typography>
            {selected.source && (
              <Typography>
                Source
                {' '}
                {selected.source}
              </Typography>
            )}
            {acceptedTaxon && (
              <Typography>
                Accepted name
                {' '}
                <Link
                  href={taxonLink(String(acceptedTaxon.tid))}
                  onClick={(event) => followTaxonLink(event, String(acceptedTaxon.tid))}
                >
                  {acceptedTaxon.name}
                </Link>
              </Typography>
            )}
            {!!selected.classification?.length && (
              <Box component="nav" aria-label="Taxon classification">
                <Typography variant="subtitle2" component="h3">Classification</Typography>
                <Box component="ol" sx={{ pl: 3 }}>
                  {selected.classification.map((ancestor) => (
                    <li key={ancestor.tid}>
                      <Link
                        href={taxonLink(String(ancestor.tid))}
                        onClick={(event) => followTaxonLink(event, String(ancestor.tid))}
                      >
                        {ancestor.name}
                      </Link>
                    </li>
                  ))}
                </Box>
              </Box>
            )}
            {!!selected.synonyms?.length && (
              <Box>
                <Typography variant="subtitle2" component="h3">Synonyms</Typography>
                <Box component="ul" sx={{ pl: 3 }}>
                  {selected.synonyms.map((synonym) => (
                    <li key={synonym.tid}>
                      <Link
                        href={taxonLink(String(synonym.tid))}
                        onClick={(event) => followTaxonLink(event, String(synonym.tid))}
                      >
                        {synonym.name}
                      </Link>
                    </li>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
