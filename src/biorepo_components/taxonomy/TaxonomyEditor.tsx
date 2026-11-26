'use client';

import React, {
  useCallback, useEffect, useId, useRef, useState,
} from 'react';
import type { SubmitEvent } from 'react';
import {
  messageFor, read, readTaxon, write,
} from './TaxonomyEditorApi';
import type {
  BiorepoTaxon,
  EditorNode,
  Page,
  Sector,
  SourceDataset,
} from './TaxonomyEditorApi';
import {
  AcceptedLinksDialog,
  EditTaxonDialog,
  EditorDialog,
  RemapDialog,
} from './TaxonomyEditorDialogs';
import TaxonomyEditorHistory, { runLabel } from './TaxonomyEditorHistory';
import type { TaxonomyRun } from './TaxonomyEditorHistory';
import TaxonomyEditorTree, { TaxonName } from './TaxonomyEditorTree';
import TaxonomyExplorer from './TaxonomyExplorer';
import styles from './TaxonomyEditor.module.css';

const tabs = ['Assembly', 'Sectors', 'Sources', 'History'] as const;
const groups = [
  'ALGAE',
  'BEETLE',
  'BIRD',
  'FISH',
  'HERPETOLOGY',
  'MACROINVERTEBRATE',
  'MOSQUITO',
  'MOSQUITO_PATHOGENS',
  'SMALL_MAMMAL',
  'PLANT',
  'TICK',
];

interface EditorProps {
  apiUrl: string;
  colApiUrl: string;
  csrfToken: string;
}

interface SourcePickerProps {
  apiUrl: string;
  onSelect: (dataset: SourceDataset) => void;
  onClose: () => void;
}

type Tab = (typeof tabs)[number];
type Dialog
  = 'add-root' | 'add-child' | 'edit' | 'accepted-links' | 'unplace' | 'remap' | 'source';

function SourcePicker({ apiUrl, onSelect, onClose }: SourcePickerProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SourceDataset[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function search(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const page = await read<Page<SourceDataset>>(apiUrl, 'source-datasets', {
        q: query.trim(),
      });
      setItems(page.items);
    } catch (err) {
      setItems(undefined);
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <EditorDialog title="Find a source dataset" onClose={onClose}>
      <div className={styles.form}>
        <form className={styles.search} onSubmit={search}>
          <input
            type="search"
            aria-label="ChecklistBank dataset name or key"
            placeholder="Dataset name or key"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="submit"
            className={styles.button}
            disabled={loading || !query.trim()}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {items
          && (items.length ? (
            <ul className={styles.datasetList}>
              {items.map((dataset) => (
                <li key={dataset.datasetKey}>
                  <button
                    type="button"
                    className={styles.nameButton}
                    onClick={() => onSelect(dataset)}
                  >
                    {dataset.label}
                    {' '}
                    <span className={styles.muted}>
                      {[dataset.version, dataset.datasetKey].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No datasets found.</p>
          ))}
      </div>
    </EditorDialog>
  );
}

function titleForSector(sector: Sector) {
  return sector.rootName || (sector.rootTid ? `Taxon ${sector.rootTid}` : 'Backbone');
}

export default function TaxonomyEditor({ apiUrl, colApiUrl, csrfToken }: EditorProps) {
  const groupId = useId();
  const [tab, setTab] = useState<Tab>('Assembly');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [selected, setSelected] = useState<BiorepoTaxon>();
  const [sourceDataset, setSourceDataset] = useState<SourceDataset>();
  const [sourceNode, setSourceNode] = useState<EditorNode>();
  const [sourceRootId, setSourceRootId] = useState<string>();
  const [sectors, setSectors] = useState<Sector[]>();
  const [sectorToRemove, setSectorToRemove] = useState<Sector>();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [running, setRunning] = useState<TaxonomyRun>();
  const stopAfterBatch = useRef(false);
  const selectedId = useRef<number | null>(null);
  const [group, setGroup] = useState('');
  const [revision, setRevision] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [version, setVersion] = useState<number>();
  const [error, setError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    read<Sector[]>(apiUrl, 'sources')
      .then((data) => {
        if (active) {
          setSectors(data);
          setSourceError('');
        }
      })
      .catch((err) => {
        if (active) setSourceError(messageFor(err));
      });
    read<{ version: number }>(apiUrl, 'version')
      .then((data) => {
        if (active) setVersion(data.version);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiUrl, revision]);

  const loadSource = useCallback(
    (parent: EditorNode['id'] | null, offset: number, limit: number) => (
      read<Page<EditorNode>>(apiUrl, 'source-tree', {
        datasetKey: sourceDataset?.datasetKey, parent, offset, limit,
      })
    ),
    [apiUrl, sourceDataset?.datasetKey],
  );
  const searchSource = useCallback(
    (q: string, offset: number, limit: number) => read<Page<EditorNode>>(apiUrl, 'source-search', {
      datasetKey: sourceDataset?.datasetKey,
      q,
      offset,
      limit,
    }),
    [apiUrl, sourceDataset?.datasetKey],
  );

  function selectDataset(dataset: SourceDataset, rootId?: string | null) {
    setSourceDataset(dataset);
    setSourceNode(undefined);
    setSourceRootId(rootId || undefined);
    setDialog(null);
  }

  const loadSelected = useCallback((tid: number) => {
    selectedId.current = tid;
    readTaxon(apiUrl, tid)
      .then((taxon) => {
        if (selectedId.current === tid) setSelected(taxon);
      })
      .catch((err) => {
        if (selectedId.current === tid) setError(messageFor(err));
      });
  }, [apiUrl]);

  const selectTaxon = useCallback((tid: number | null) => {
    if (selectedId.current === tid) return;
    setSelected(undefined);
    selectedId.current = tid;
    if (tid !== null) loadSelected(tid);
  }, [loadSelected]);

  function showTaxonInAssembly(tid: number | null) {
    const url = new URL(window.location.href);
    if (tid === null) url.searchParams.delete('tid');
    else url.searchParams.set('tid', String(tid));
    if (url.href !== window.location.href) window.history.pushState(null, '', url.href);
    setNavigationVersion((version) => version + 1);
    setTab('Assembly');
  }

  function refreshView() {
    setRevision((n) => n + 1);
    if (selectedId.current !== null) loadSelected(selectedId.current);
  }

  function openSector(sector: Sector) {
    selectDataset(sector, sector.sourceRootId);
    showTaxonInAssembly(sector.rootTid || null);
  }

  async function mutate(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function saveSource(tid: number) {
    if (!sourceDataset) return;
    mutate(async () => {
      await write<Sector>(apiUrl, csrfToken, 'save-source', {
        rootTid: tid,
        datasetKey: sourceDataset.datasetKey,
        label: sourceDataset.label,
        sourceRootId: tid ? sourceRootId : undefined,
      });
      setNotice(
        'Source assignment saved. Refresh this sector to update its classification.',
      );
      refreshView();
      setTab('Sectors');
    });
  }

  function deleteSource() {
    if (!sectorToRemove) return;
    mutate(async () => {
      await write(apiUrl, csrfToken, 'delete-source', { rootTid: sectorToRemove.rootTid });
      setSectorToRemove(undefined);
      setNotice(
        'Source assignment removed. Refresh the backbone to classify this branch.',
      );
      refreshView();
    });
  }

  function runUpdate(kind: 'refresh' | 'neon', target: number | string, runId?: number) {
    mutate(async () => {
      stopAfterBatch.current = false;
      const action = kind === 'neon' ? 'import-neon' : 'refresh';
      const fields = kind === 'neon' ? { group: target } : { rootTid: target };
      let run: TaxonomyRun | undefined;
      try {
        do {
          // Each request advances the run created by the previous request.
          // eslint-disable-next-line no-await-in-loop
          run = await write<TaxonomyRun>(apiUrl, csrfToken, action, {
            ...fields,
            runId: run?.runId ?? runId,
          });
          setRunning(run);
          if (run.status === 'running' && !stopAfterBatch.current) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise<void>((resolve) => { setTimeout(resolve, 200); });
          }
        } while (run.status === 'running' && !stopAfterBatch.current);

        const counts = `${run.changed ?? 0} changed, ${run.unresolved ?? 0} unresolved`;
        setNotice(
          run.status === 'running'
            ? 'Update paused. Resume it from History.'
            : `${runLabel(run)} ${run.status}. ${counts}.`,
        );
      } finally {
        setRunning(undefined);
        refreshView();
        if (run?.runId ?? runId) {
          setSelectedRunId(run?.runId ?? runId ?? null);
          setTab('History');
        }
      }
    });
  }

  function cancelRun(run: TaxonomyRun) {
    mutate(async () => {
      await write(apiUrl, csrfToken, 'cancel-run', { runId: run.runId });
      setNotice('Update cancelled.');
      refreshView();
    });
  }

  function rebuild() {
    mutate(async () => {
      const result = await write<{ runId: number }>(apiUrl, csrfToken, 'rebuild', {});
      setNotice('Taxonomic hierarchy rebuilt.');
      setSelectedRunId(result.runId);
      refreshView();
    });
  }

  function unplace() {
    if (!selected) return;
    mutate(async () => {
      await write(apiUrl, csrfToken, 'unplace', { tid: selected.tid });
      setDialog(null);
      setNotice(`${selected.name} removed from the tree.`);
      refreshView();
    });
  }

  function clearOverride() {
    if (!selected) return;
    mutate(async () => {
      await write(apiUrl, csrfToken, 'clear-override', { tid: selected.tid });
      setNotice('The next refresh will use the assigned source for this name.');
      refreshView();
    });
  }

  const activeSector = selected && sectors?.find((sector) => sector.rootTid === selected.tid);
  const sourceTaxon = sourceNode?.name || sourceRootId;
  const sourceButton = (
    <button type="button" className={styles.button} onClick={() => setDialog('source')}>
      Find dataset
    </button>
  );

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <nav className={styles.nav} aria-label="Taxonomy management">
          {tabs.map((item) => (
            <button
              className={styles.tab}
              type="button"
              key={item}
              aria-current={item === tab ? 'page' : undefined}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        {version !== undefined && (
          <span className={styles.muted}>
            Version {version}
          </span>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {running && (
        <div className={styles.notice}>
          <div className={styles.actions}>
            <span role="status">
              {runLabel(running)}
              {' '}
              ·
              {running.processed ?? 0}
              {' '}
              processed
            </span>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                stopAfterBatch.current = true;
                setNotice('Pausing after the current batch.');
              }}
            >
              Pause
            </button>
          </div>
        </div>
      )}

      {tab === 'Assembly' && (
        <>
          <div className={styles.workspace}>
            <section className={styles.panel} aria-label="Biorepository assembly">
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Biorepository assembly</h2>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => setDialog('add-root')}
                  >
                    Add root
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={refreshView}
                  >
                    Reload tree
                  </button>
                </div>
              </div>
              <div className={styles.panelBody}>
                <TaxonomyExplorer
                  apiUrl={apiUrl}
                  colApiUrl={colApiUrl}
                  editorTree={{ revision, navigationVersion, onSelectionChange: selectTaxon }}
                />
              </div>
            </section>
            {sourceDataset ? (
              <TaxonomyEditorTree
                key={sourceDataset.datasetKey}
                title={sourceDataset.label}
                loadChildren={loadSource}
                search={searchSource}
                selected={sourceNode?.id ?? sourceRootId}
                onSelect={(node) => {
                  setSourceNode(node);
                  setSourceRootId(String(node.id));
                }}
                actions={sourceButton}
              />
            ) : (
              <section className={styles.panel} aria-label="Source taxonomy">
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>Source taxonomy</h2>
                  {sourceButton}
                </div>
                <div className={styles.panelBody}>
                  <p className={styles.muted}>
                    Choose a ChecklistBank dataset to browse its classification.
                  </p>
                </div>
              </section>
            )}
          </div>
          {selected && (
            <section
              className={`${styles.panel} ${styles.selection}`}
              aria-label="Selected Biorepository taxon"
            >
              <div className={styles.actions}>
                <div>
                  <TaxonName node={selected} />
                  {selected.source && <p className={styles.muted}>{selected.source}</p>}
                  {selected.editorialOverride && (
                    <p className={styles.muted}>Manual classification</p>
                  )}
                  {activeSector && (
                    <p className={styles.muted}>
                      Assigned sector ·
                      {activeSector.label}
                    </p>
                  )}
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => setDialog('edit')}
                  >
                    Edit taxon
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={
                      busy
                      || selected.acceptedTid !== selected.tid
                      || selected.status === 'unplaced'
                    }
                    onClick={() => setDialog('add-child')}
                  >
                    Add child
                  </button>
                  {selected.acceptedTid && selected.acceptedTid !== selected.tid && (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busy}
                      onClick={() => setDialog('accepted-links')}
                    >
                      Accepted names
                    </button>
                  )}
                  {selected.acceptedTid && selected.status !== 'unplaced' && (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busy}
                      onClick={() => setDialog('unplace')}
                    >
                      Remove from tree
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => setDialog('remap')}
                  >
                    Remap specimens
                  </button>
                </div>
              </div>
              {selected.editorialOverride && (
                <div>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => clearOverride()}
                  >
                    Use assigned source on next refresh
                  </button>
                </div>
              )}
              {sourceDataset && (
                <div className={styles.actions}>
                  <p className={styles.muted}>
                    {sourceTaxon ? `Source taxon · ${sourceTaxon}`
                      : 'The source taxon will be matched by scientific name.'}
                  </p>
                  <div className={styles.actions}>
                    {sourceRootId && (
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => {
                          setSourceRootId(undefined);
                          setSourceNode(undefined);
                        }}
                      >
                        Clear source taxon
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={
                        busy
                        || selected.acceptedTid !== selected.tid
                        || selected.status === 'unplaced'
                      }
                      onClick={() => saveSource(selected.tid)}
                    >
                      Save sector
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'Sectors' && (
        <section className={styles.panel} aria-label="Taxonomy sectors">
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Sectors</h2>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={rebuild}
            >
              Rebuild hierarchy
            </button>
          </div>
          <div className={styles.panelBody}>
            {sourceError && (
              <p className={styles.error} role="alert">
                {sourceError}
              </p>
            )}
            {!sectors && !sourceError && <p role="status">Loading sectors…</p>}
            {sectors
              && (sectors.length ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Biorepository taxon</th>
                        <th scope="col">Source dataset</th>
                        <th scope="col">Source taxon ID</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectors.map((sector) => (
                        <tr key={sector.rootTid}>
                          <td>{titleForSector(sector)}</td>
                          <td>
                            {sector.label}
                            {sector.version && (
                              <div className={styles.muted}>{sector.version}</div>
                            )}
                          </td>
                          <td>{sector.sourceRootId || '—'}</td>
                          <td>
                            <div className={styles.actions}>
                              <button
                                type="button"
                                className={styles.button}
                                onClick={() => openSector(sector)}
                              >
                                Open in assembly
                              </button>
                              <button
                                type="button"
                                className={styles.primary}
                                onClick={() => runUpdate('refresh', sector.rootTid)}
                                disabled={busy}
                              >
                                Refresh sector
                              </button>
                              {sector.rootTid > 0 && (
                                <button
                                  type="button"
                                  className={styles.button}
                                  disabled={busy}
                                  onClick={() => setSectorToRemove(sector)}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted}>
                  No source assignments. Open Assembly to choose a taxon and dataset.
                </p>
              ))}
          </div>
        </section>
      )}

      {tab === 'Sources' && (
        <div className={styles.workspace}>
          <section className={styles.panel} aria-label="ChecklistBank data sources">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>ChecklistBank sources</h2>
              {sourceButton}
            </div>
            <div className={styles.panelBody}>
              {sectors && (
                <div>
                  <p className={styles.muted}>Current backbone</p>
                  <p>
                    {sectors.find((sector) => sector.rootTid === 0)?.label
                      || 'No backbone assigned.'}
                  </p>
                </div>
              )}
              {sourceDataset && (
                <div className={styles.actions}>
                  <span>
                    {sourceDataset.label}
                    {' '}
                    <span className={styles.muted}>
                      {sourceDataset.version || sourceDataset.datasetKey}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => setTab('Assembly')}
                  >
                    Browse source
                  </button>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => saveSource(0)}
                  >
                    Use as backbone
                  </button>
                </div>
              )}
            </div>
          </section>
          <section className={styles.panel} aria-label="Import NEON taxon names">
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>NEON taxon names</h2>
            </div>
            <form
              className={styles.panelBody}
              onSubmit={(event) => {
                event.preventDefault();
                if (group) runUpdate('neon', group);
              }}
            >
              <label className={styles.field} htmlFor={groupId}>
                Taxon group
                <select
                  id={groupId}
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  required
                  disabled={busy}
                >
                  <option value="">Select group</option>
                  {groups.map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button type="submit" className={styles.primary} disabled={!group || busy}>
                  Import name updates
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {tab === 'History' && (
        <TaxonomyEditorHistory
          apiUrl={apiUrl}
          revision={revision}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
          busy={busy}
          onOpenTaxon={showTaxonInAssembly}
          onResume={(run) => (run.kind === 'neon'
            ? runUpdate('neon', run.group ?? '', run.runId)
            : runUpdate('refresh', run.rootTid ?? 0, run.runId))}
          onCancel={(run) => cancelRun(run)}
        />
      )}

      {dialog === 'source' && (
        <SourcePicker
          apiUrl={apiUrl}
          onSelect={(dataset) => selectDataset(dataset)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'remap' && selected && (
        <RemapDialog
          apiUrl={apiUrl}
          csrfToken={csrfToken}
          taxon={selected}
          onClose={() => {
            setDialog(null);
            refreshView();
          }}
        />
      )}
      {dialog === 'accepted-links' && selected && (
        <AcceptedLinksDialog
          apiUrl={apiUrl}
          csrfToken={csrfToken}
          taxon={selected}
          onClose={() => setDialog(null)}
          onChanged={(taxon) => {
            setSelected(taxon);
            setRevision((n) => n + 1);
          }}
        />
      )}
      {dialog === 'unplace' && selected && (
        <EditorDialog
          title={`Remove ${selected.name} from the tree`}
          onClose={() => setDialog(null)}
          busy={busy}
        >
          <div className={styles.form}>
            <p>
              The taxon will still be available to editors by scientific name. Its specimen
              links will stay in place.
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div>
              <button
                type="button"
                className={styles.primary}
                onClick={unplace}
                disabled={busy}
              >
                Remove from tree
              </button>
            </div>
          </div>
        </EditorDialog>
      )}
      {(dialog === 'add-root'
        || (dialog === 'add-child' && selected)
        || (dialog === 'edit' && selected)) && (
        <EditTaxonDialog
          apiUrl={apiUrl}
          csrfToken={csrfToken}
          taxon={dialog === 'edit' ? selected : undefined}
          initialParent={dialog === 'add-child' ? selected : undefined}
          onClose={() => setDialog(null)}
          onSaved={(tid) => {
            setDialog(null);
            setNotice('Taxon saved.');
            setRevision((n) => n + 1);
            if (selectedId.current === tid) loadSelected(tid);
            showTaxonInAssembly(tid);
          }}
        />
      )}
      {sectorToRemove && (
        <EditorDialog
          title="Remove sector assignment"
          onClose={() => setSectorToRemove(undefined)}
          busy={busy}
        >
          <div className={styles.form}>
            <p>
              Remove the source assignment for
              {' '}
              <strong>{titleForSector(sectorToRemove)}</strong>
              ?
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div>
              <button
                type="button"
                className={styles.primary}
                onClick={deleteSource}
                disabled={busy}
              >
                Remove assignment
              </button>
            </div>
          </div>
        </EditorDialog>
      )}
    </div>
  );
}
