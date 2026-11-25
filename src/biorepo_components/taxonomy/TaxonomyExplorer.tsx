import React, { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, MouseEvent, SyntheticEvent } from 'react';
import ChevronRight from '@mui/icons-material/ChevronRight';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, Link, Paper, Stack, Switch,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
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

interface RecordPhoto {
  url: string;
  thumbnailUrl: string | null;
  recordUrl: string;
  caption: string | null;
  credit: string | null;
}

type PhotoResult = { tid: number; photo: RecordPhoto | null };

type RecordSearch = { count: number; url: string };
type RecordSearchResult = { tid: number; search: RecordSearch };

const detailSectionStyle = { px: 2.5, py: 1.75 };
const speciesCountSelector = '.neon-taxonomy-species-count';

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

function recordsOnlyFromLocation() {
  return new URLSearchParams(window.location.search).get('records') === '1';
}

export default function TaxonomyExplorer({ apiUrl }: TaxonomyExplorerProps) {
  const [recordsOnly, setRecordsOnly] = useState(recordsOnlyFromLocation);
  const [activeTid, setActiveTid] = useState(selectedTaxon);
  const [revealInTree, setRevealInTree] = useState(true);
  const [expandedTid, setExpandedTid] = useState<string>();
  const [treeVisit, setTreeVisit] = useState(0);
  const [result, setResult] = useState<TaxonResult | null>(null);
  const [photoResult, setPhotoResult] = useState<PhotoResult | null>(null);
  const [recordResult, setRecordResult] = useState<RecordSearchResult | null>(null);

  const publicResult = result?.tid === activeTid ? result : null;
  const selected = publicResult && 'taxon' in publicResult ? publicResult.taxon : null;
  const error = publicResult && 'error' in publicResult ? publicResult.error : null;
  const detailTid = selected?.tid;
  const photo = photoResult?.tid === detailTid ? photoResult?.photo : null;
  const recordSearch = recordResult?.tid === detailTid ? recordResult?.search : null;

  const expandToTaxon = useCallback((tid: string | undefined) => {
    setExpandedTid(tid);
    // The tree applies a host-driven expansion when it loads.
    setTreeVisit((visit) => visit + 1);
  }, []);

  useEffect(() => {
    function onPopState() {
      const tid = selectedTaxon();
      setRecordsOnly(recordsOnlyFromLocation());
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

  useEffect(() => {
    if (!apiUrl || !detailTid) return undefined;
    const tid = detailTid;
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

    loadRecordData<RecordPhoto | null>('taxon-photo', (newPhoto) => {
      setPhotoResult({ tid, photo: newPhoto });
    });
    loadRecordData<RecordSearch>('taxon-records', (search) => setRecordResult({ tid, search }));
    return () => controller.abort();
  }, [apiUrl, detailTid]);

  const changeRecordsFilter = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.target;
    const url = new URL(taxonLink());
    if (checked) {
      url.searchParams.set('records', '1');
    } else {
      url.searchParams.delete('records');
    }
    window.history.pushState(null, '', url.href);
    setRecordsOnly(checked);
    setActiveTid(undefined);
    setExpandedTid(undefined);
    setResult(null);
  }, []);

  const handlePhotoError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    if (!photo) return;
    const image = event.currentTarget;
    const fullUrl = new URL(photo.url, window.location.href).href;
    if (image.src !== fullUrl) {
      image.src = fullUrl;
    } else {
      setPhotoResult(null);
    }
  }, [photo]);

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

  const taxonProfileLink = useCallback((tid: string) => {
    const api = new URL(apiUrl, window.location.href);
    const url = new URL('../../taxa/index.php', api);
    url.searchParams.set('tid', tid);
    return url.href;
  }, [apiUrl]);

  const selectTreeRow = useCallback((event: MouseEvent<HTMLElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button !== 0 || modified) return;
    if (!(event.target instanceof Element)) return;
    const { target } = event;
    const row = target.closest('[role="treeitem"]');
    if (!row || target.closest('.ant-tree-switcher, button, [role="button"]')) return;
    if (target.closest('a[href]') && !target.closest(speciesCountSelector)) return;
    const link = row.querySelector<HTMLAnchorElement>('.ant-tree-title a[href]');
    if (!link) return;
    const url = new URL(link.href);
    const tid = url.searchParams.get('tid');
    if (!tid || url.href !== taxonProfileLink(tid)) return;
    event.preventDefault();
    openTaxon(tid);
  }, [openTaxon, taxonProfileLink]);

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

  const acceptedTaxon = selected?.acceptedTaxon;
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
        aria-label="Taxonomy tree"
        onClickCapture={selectTreeRow}
        sx={{
          minWidth: 0,
          overflowX: 'auto',
          '& .ant-tree-node-content-wrapper': { cursor: 'pointer' },
          [`& ${speciesCountSelector}`]: { color: 'text.primary', whiteSpace: 'nowrap' },
        }}
      >
        <FormControlLabel
          label="Only taxa with records"
          control={(
            <Switch
              color="primary"
              size="medium"
              checked={recordsOnly}
              onChange={changeRecordsFilter}
              slotProps={{ input: { role: 'switch' } }}
            />
          )}
          sx={{ mb: 1 }}
        />
        <Tree
          key={`${recordsOnly}-${treeVisit}`}
          datasetKey={recordsOnly ? 2 : 1}
          autoFocus={false}
          insertPlaceholder={false}
          defaultTaxonKey={expandedTid}
          onExpandedTaxonKeyChange={revealTaxon}
          hrefForTaxon={taxonProfileLink}
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
                  {recordSearch && (
                    <Button
                      href={recordSearch.url}
                      variant="contained"
                      size="medium"
                      fullWidth
                      endIcon={<ChevronRight />}
                    >
                      {`Browse ${recordSearch.count.toLocaleString()} `}
                      {recordSearch.count === 1 ? 'Record' : 'Records'}
                    </Button>
                  )}
                </Stack>
              </Box>
              {photo && (
                <Box component="figure" sx={{ ...detailSectionStyle, m: 0 }}>
                  <Link href={photo.recordUrl} sx={{ display: 'block' }}>
                    <Box
                      component="img"
                      src={photo.thumbnailUrl || photo.url}
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
                  </Link>
                  {(photo.caption || photo.credit) && (
                    <Box component="figcaption" sx={{ mt: 1 }}>
                      {photo.caption && <Typography variant="body2">{photo.caption}</Typography>}
                      {photo.credit && (
                        <Typography variant="caption" color="text.secondary">
                          {photo.credit}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              )}
              {acceptedTaxon && (
                <Box sx={detailSectionStyle}>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
                    Accepted name
                  </Typography>
                  <Typography variant="body2">{detailLink(acceptedTaxon)}</Typography>
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
              {!!selected.synonyms?.length && (
                <Box sx={detailSectionStyle}>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 0.75 }}>
                    Synonyms
                  </Typography>
                  <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {selected.synonyms.map((synonym) => (
                      <Typography component="li" variant="body2" key={synonym.tid}>
                        {detailLink(synonym)}
                      </Typography>
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
