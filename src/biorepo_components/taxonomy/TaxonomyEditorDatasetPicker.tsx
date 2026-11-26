import React, { useEffect, useState } from 'react';
import Cancel from '@mui/icons-material/Cancel';
import Search from '@mui/icons-material/Search';
import { Autocomplete, TextField } from '@mui/material';
import { messageFor, read } from './TaxonomyEditorApi';
import type { Page, SourceDataset } from './TaxonomyEditorApi';

interface DatasetPickerProps {
  apiUrl: string;
  dataset?: SourceDataset;
  onSelect: (dataset: SourceDataset) => void;
  onClear: () => void;
}

interface DatasetSearchResult {
  apiUrl: string;
  term: string;
  items: SourceDataset[];
  error?: string;
}

function datasetLabel({ label, datasetKey, version }: SourceDataset) {
  const versionLabel = version && !label.includes(version) ? ` ${version}` : '';
  return `${label}${versionLabel} [${datasetKey}]`;
}

export default function TaxonomyEditorDatasetPicker({
  apiUrl, dataset, onSelect, onClear,
}: DatasetPickerProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [result, setResult] = useState<DatasetSearchResult>();
  const term = query?.trim() ?? '';
  const searchResult = result?.term === term && result.apiUrl === apiUrl ? result : undefined;

  useEffect(() => {
    if (!term) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { items } = await read<Page<SourceDataset>>(
          apiUrl, 'source-datasets', { q: term }, { signal: controller.signal },
        );
        if (!controller.signal.aborted) setResult({ apiUrl, term, items });
      } catch (err) {
        if (!controller.signal.aborted) setResult({ apiUrl, term, items: [], error: messageFor(err) });
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, term]);

  function resetQuery() {
    setQuery(null);
    setResult(undefined);
  }

  return (
    <Autocomplete
      fullWidth
      size="small"
      openOnFocus
      autoHighlight
      options={searchResult?.items ?? []}
      value={dataset ?? null}
      inputValue={query ?? (dataset ? datasetLabel(dataset) : '')}
      loading={!!term && !searchResult}
      loadingText={<span role="status">Searching datasets…</span>}
      noOptionsText={searchResult?.error ? (
        <span role="alert">{searchResult.error}</span>
      ) : (
        <span role="status">{term ? 'No datasets found.' : 'Enter a dataset name or key.'}</span>
      )}
      filterOptions={(options) => options}
      getOptionLabel={datasetLabel}
      getOptionKey={({ datasetKey }) => datasetKey}
      isOptionEqualToValue={(option, value) => option.datasetKey === value.datasetKey}
      clearIcon={<Cancel sx={{ fontSize: 14 }} />}
      clearText="Clear source dataset"
      popupIcon={<Search fontSize="small" />}
      openText="Search datasets"
      closeText="Close dataset suggestions"
      onInputChange={(_, value, reason) => {
        if (reason === 'input') {
          if (value.trim() !== term) setResult(undefined);
          setQuery(value);
        } else {
          resetQuery();
        }
      }}
      onChange={(_, option) => {
        resetQuery();
        if (option) onSelect(option);
        else onClear();
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Find a source dataset"
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'ChecklistBank dataset name or key' },
          }}
        />
      )}
      sx={{
        '& .MuiOutlinedInput-root': { borderRadius: '4px', py: 0, minHeight: 34, fontSize: '0.875rem' },
        '& .MuiAutocomplete-inputRoot .MuiAutocomplete-input': { py: '5px' },
        '& .MuiAutocomplete-popupIndicatorOpen': { transform: 'none' },
        '& .MuiAutocomplete-clearIndicator': { visibility: 'visible' },
      }}
    />
  );
}
