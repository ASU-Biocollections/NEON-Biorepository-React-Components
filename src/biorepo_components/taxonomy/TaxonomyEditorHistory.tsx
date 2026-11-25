'use client';

import React, { useEffect, useState } from 'react';
import { messageFor, read } from './TaxonomyEditorApi';
import styles from './TaxonomyEditor.module.css';

export interface TaxonomyRun {
  id: number;
  runId: number;
  kind: 'refresh' | 'neon' | 'edit' | 'remap';
  status: 'running' | 'complete' | 'cancelled' | 'stale' | 'failed';
  rootTid?: number | null;
  datasetKey?: string | null;
  group?: string | null;
  baseVersion?: number | null;
  version?: number | null;
  processed?: number;
  changed?: number;
  unresolved?: number;
  message?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface Change {
  id: number;
  tid?: number | null;
  name: string;
  outcome: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

interface RunDetails extends TaxonomyRun {
  changes: Change[];
  changeTotal: number;
}

const CHANGE_LIMIT = 40;

const CHANGE_FIELDS = {
  tid: 'Taxon ID',
  name: 'Name',
  author: 'Authorship',
  rankId: 'Rank ID',
  parentTid: 'Parent ID',
  acceptedTid: 'Accepted ID',
  acceptedTids: 'Accepted IDs',
  kingdomName: 'Kingdom',
  status: 'Status',
  source: 'Source',
  sourceId: 'Source ID',
  sinceOccid: 'After specimen ID',
  throughOccid: 'Through specimen ID',
  occurrences: 'Specimens updated',
} as const;

export function runLabel(run: TaxonomyRun) {
  if (run.kind === 'neon') return `NEON import${run.group ? ` · ${run.group}` : ''}`;
  if (run.kind === 'edit') return 'Manual taxon edit';
  if (run.kind === 'remap') return 'Specimen remap';
  return run.rootTid ? `Sector refresh · Taxon ${run.rootTid}` : 'Backbone refresh';
}

function ChangeState({ state }: { state?: Record<string, unknown> | null }) {
  if (!state) return null;
  return Object.entries(CHANGE_FIELDS).map(([key, label]) => {
    if (!(key in state)) return null;
    const value = state[key];
    return (
      <div key={key}>
        {label}
        {' '}
        <strong>{value === null ? 'None' : String(value)}</strong>
      </div>
    );
  });
}

interface HistoryProps {
  apiUrl: string;
  revision: number;
  selectedRunId: number | null;
  onSelect: (runId: number | null) => void;
  onOpenTaxon: (tid: number) => void;
  busy: boolean;
  onResume: (run: TaxonomyRun) => void;
  onCancel: (run: TaxonomyRun) => void;
}

export default function TaxonomyEditorHistory({
  apiUrl,
  revision,
  selectedRunId,
  onSelect,
  onOpenTaxon,
  busy,
  onResume,
  onCancel,
}: HistoryProps) {
  const [runs, setRuns] = useState<TaxonomyRun[]>();
  const [listError, setListError] = useState('');
  const [details, setDetails] = useState<RunDetails>();
  const [detailsError, setDetailsError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    read<TaxonomyRun[]>(apiUrl, 'runs')
      .then((data) => {
        if (active) {
          setRuns(data);
          setListError('');
        }
      })
      .catch((err) => {
        if (active) setListError(messageFor(err));
      });
    return () => {
      active = false;
    };
  }, [apiUrl, revision, reload]);

  useEffect(() => {
    if (!selectedRunId) return undefined;
    let active = true;
    read<RunDetails>(apiUrl, 'run', { runId: selectedRunId, limit: CHANGE_LIMIT })
      .then((data) => {
        if (active) {
          setDetails(data);
          setDetailsError('');
        }
      })
      .catch((err) => {
        if (active) setDetailsError(messageFor(err));
      });
    return () => {
      active = false;
    };
  }, [apiUrl, revision, reload, selectedRunId]);

  async function loadMore() {
    if (loadingMore || !selectedRunId || !details) return;
    setDetailsError('');
    setLoadingMore(true);
    try {
      const page = await read<RunDetails>(apiUrl, 'run', {
        runId: selectedRunId,
        limit: CHANGE_LIMIT,
        offset: details.changes.length,
      });
      setDetails((current) => (current?.runId === page.runId
        ? { ...page, changes: [...current.changes, ...page.changes] }
        : current));
    } catch (err) {
      setDetailsError(messageFor(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Taxonomy update history">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Update history</h2>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() => setReload((n) => n + 1)}
        >
          Reload history
        </button>
      </div>
      <div className={styles.panelBody}>
        {listError && (
          <p className={styles.error} role="alert">
            {listError}
          </p>
        )}
        {!runs && !listError && <p role="status">Loading history…</p>}
        {runs
          && (runs.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Update</th>
                    <th scope="col">Status</th>
                    <th scope="col">Version</th>
                    <th scope="col">Changed</th>
                    <th scope="col">Unresolved</th>
                    <th scope="col">Started</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.runId}>
                      <td>{runLabel(run)}</td>
                      <td>{run.status}</td>
                      <td>{run.version ?? '—'}</td>
                      <td>{run.changed ?? '—'}</td>
                      <td>{run.unresolved ?? '—'}</td>
                      <td>{run.startedAt || '—'}</td>
                      <td>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.button}
                            aria-expanded={selectedRunId === run.runId}
                            onClick={() => {
                              setDetails(undefined);
                              setDetailsError('');
                              onSelect(selectedRunId === run.runId ? null : run.runId);
                            }}
                          >
                            Changes
                          </button>
                          {run.status === 'running' && (
                            <>
                              <button
                                type="button"
                                className={styles.button}
                                disabled={busy}
                                onClick={() => onResume(run)}
                              >
                                Resume
                              </button>
                              <button
                                type="button"
                                className={styles.button}
                                disabled={busy}
                                onClick={() => onCancel(run)}
                              >
                                Cancel update
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.muted}>No taxonomy updates yet.</p>
          ))}
        {selectedRunId && (
          <section className={styles.details} aria-label="Selected update changes">
            {detailsError && (
              <p className={styles.error} role="alert">
                {detailsError}
              </p>
            )}
            {(!details || details.runId !== selectedRunId) && !detailsError && (
              <p role="status">Loading changes…</p>
            )}
            {details?.runId === selectedRunId && (
              <>
                <h3>{runLabel(details)}</h3>
                {details.message && <p>{details.message}</p>}
                {details.changes.length ? (
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">Taxon</th>
                          <th scope="col">Outcome</th>
                          <th scope="col">Before</th>
                          <th scope="col">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.changes.map((change) => (
                          <tr key={change.id}>
                            <td>
                              {change.tid ? (
                                <button
                                  type="button"
                                  className={styles.nameButton}
                                  onClick={() => {
                                    if (change.tid) onOpenTaxon(change.tid);
                                  }}
                                >
                                  {change.name}
                                </button>
                              ) : (
                                change.name
                              )}
                            </td>
                            <td>
                              {change.outcome}
                              {change.reason && (
                                <div className={styles.muted}>{change.reason}</div>
                              )}
                            </td>
                            <td>
                              <ChangeState state={change.before} />
                            </td>
                            <td>
                              <ChangeState state={change.after} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.muted}>No changes recorded for this update.</p>
                )}
                {details.changes.length < details.changeTotal && (
                  <div>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={loadingMore}
                      onClick={() => loadMore()}
                    >
                      {loadingMore ? 'Loading…' : 'More changes'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
