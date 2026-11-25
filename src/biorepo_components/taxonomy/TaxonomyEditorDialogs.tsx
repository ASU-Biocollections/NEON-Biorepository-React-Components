'use client';

import React, {
  useEffect, useId, useRef, useState,
} from 'react';
import type { SubmitEvent, ReactNode } from 'react';
import {
  messageFor, read, readTaxa, readTaxon, write,
} from './TaxonomyEditorApi';
import type { BiorepoTaxon } from './TaxonomyEditorApi';
import { TaxonName } from './TaxonomyEditorTree';
import styles from './TaxonomyEditor.module.css';

interface DialogProps {
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
}

export function EditorDialog({
  title, children, busy, onClose,
}: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.panelHeader}>
        <h2 id={titleId} className={styles.panelTitle}>
          {title}
        </h2>
        <button type="button" className={styles.button} disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

interface LinkTarget {
  tid: number;
  name: string;
}

interface PickerProps {
  apiUrl: string;
  label: string;
  value: LinkTarget | null;
  exclude?: number;
  filter?: (node: BiorepoTaxon) => boolean;
  disabled?: boolean;
  onSelect: (node: LinkTarget | null) => void;
}

function TaxonPicker({
  apiUrl,
  label,
  value,
  exclude,
  filter,
  disabled,
  onSelect,
}: PickerProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BiorepoTaxon[]>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!query.trim() || loading) return;
    setError('');
    setLoading(true);
    try {
      const page = await readTaxa(apiUrl, 'search', { q: query.trim(), limit: 12 });
      setResults(
        page.items.filter((node) => node.tid !== exclude && (!filter || filter(node))),
      );
    } catch (err) {
      setResults(undefined);
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {value && (
        <div className={styles.actions}>
          <span className={styles.selectedName}>{value.name}</span>
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => onSelect(null)}
          >
            Clear
          </button>
        </div>
      )}
      <div className={styles.search}>
        <input
          id={id}
          type="search"
          placeholder="Find by scientific name"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              search();
            }
          }}
        />
        <button
          type="button"
          className={styles.button}
          disabled={disabled || loading || !query.trim()}
          onClick={() => search()}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {results
        && (results.length ? (
          <ul className={styles.pickerResults}>
            {results.map((node) => (
              <li key={node.tid}>
                <button
                  className={styles.nameButton}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onSelect({ tid: node.tid, name: node.name });
                    setResults(undefined);
                    setQuery('');
                  }}
                >
                  <TaxonName node={node} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No names found.</p>
        ))}
    </div>
  );
}

function sameTid(tid?: number | null, other?: number) {
  return tid !== null && tid !== undefined && tid === other;
}

function placed(node: BiorepoTaxon) {
  return !!node.acceptedTid && node.status !== 'unplaced';
}

function acceptedNode(node: BiorepoTaxon) {
  return placed(node) && node.acceptedTid === node.tid;
}

function useLinkedTaxon(apiUrl: string, tid?: number | null, provided?: LinkTarget | null) {
  const [value, setValue] = useState<LinkTarget | null>(
    provided ?? (tid ? { tid, name: `Taxon ${tid}` } : null),
  );
  const request = useRef(tid && !provided ? tid : null);
  useEffect(() => {
    const target = request.current;
    if (!target) return undefined;
    let active = true;
    readTaxon(apiUrl, target)
      .then((taxon) => {
        if (active) setValue((current) => (sameTid(current?.tid, target) ? taxon : current));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiUrl]);
  return [value, setValue] as const;
}

interface EditProps {
  apiUrl: string;
  csrfToken: string;
  taxon?: BiorepoTaxon;
  initialParent?: BiorepoTaxon;
  onSaved: (tid: number) => void;
  onClose: () => void;
}

interface RankOption {
  id: number;
  name: string;
}

const acceptedStatuses = ['accepted', 'provisionally accepted'];
const synonymStatuses = ['synonym', 'ambiguous synonym', 'misapplied'];

export function EditTaxonDialog({
  apiUrl,
  csrfToken,
  taxon,
  initialParent,
  onSaved,
  onClose,
}: EditProps) {
  const fieldId = useId();
  const [name, setName] = useState(taxon?.name ?? '');
  const [author, setAuthor] = useState(taxon?.author ?? '');
  const [rankId, setRankId] = useState(taxon?.rankId != null ? String(taxon.rankId) : '');
  const linkedAsSynonym = !!(taxon?.acceptedTid && taxon.acceptedTid !== taxon.tid);
  const defaultStatus = linkedAsSynonym ? 'synonym' : 'accepted';
  const initialStatus = taxon?.status && taxon.status !== 'unplaced' ? taxon.status : defaultStatus;
  const [status, setStatus] = useState(initialStatus);
  const synonym = synonymStatuses.includes(status)
    || (status === initialStatus && linkedAsSynonym && !acceptedStatuses.includes(status));
  const [kingdomName, setKingdomName] = useState(taxon?.kingdomName ?? '');
  const [parent, setParent] = useLinkedTaxon(apiUrl, taxon?.parentTid, initialParent);
  const [accepted, setAccepted] = useLinkedTaxon(
    apiUrl,
    linkedAsSynonym ? taxon?.acceptedTid : null,
  );
  const [source, setSource] = useState(taxon?.source ?? '');
  const [sourceId, setSourceId] = useState(taxon?.sourceId ?? '');
  const [ranks, setRanks] = useState<RankOption[]>([]);
  const [loadingRanks, setLoadingRanks] = useState(true);
  const [rankError, setRankError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loadingRanks) return undefined;
    let active = true;
    read<{ ranks: RankOption[] }>(apiUrl, 'options')
      .then(({ ranks: items }) => {
        if (active) setRanks(items);
      })
      .catch((err) => {
        if (active) setRankError(messageFor(err));
      })
      .finally(() => {
        if (active) setLoadingRanks(false);
      });
    return () => {
      active = false;
    };
  }, [apiUrl, loadingRanks]);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !rankId || (synonym && !accepted) || busy) return;
    setError('');
    setBusy(true);
    try {
      const saved = await write<{ tid: number }>(apiUrl, csrfToken, 'save', {
        tid: taxon?.tid,
        name: name.trim(),
        author: author.trim(),
        rankId: Number(rankId),
        kingdomName: kingdomName.trim() || undefined,
        status,
        parentTid: parent?.tid ?? null,
        acceptedTid: synonym ? accepted?.tid : null,
        source: source.trim() || (taxon ? '' : undefined),
        sourceId: sourceId.trim() || null,
      });
      onSaved(saved.tid);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const addTitle = initialParent ? 'Add child taxon' : 'Add root taxon';
  return (
    <EditorDialog
      title={taxon ? `Edit ${taxon.name}` : addTitle}
      busy={busy}
      onClose={onClose}
    >
      <form className={styles.form} onSubmit={save}>
        <label className={styles.field} htmlFor={`${fieldId}-name`}>
          Scientific name
          {' '}
          <input
            id={`${fieldId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={250}
            required
            disabled={busy}
          />
        </label>
        <label className={styles.field} htmlFor={`${fieldId}-author`}>
          Authorship
          {' '}
          <input
            id={`${fieldId}-author`}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={150}
            disabled={busy}
          />
        </label>
        <label className={styles.field} htmlFor={`${fieldId}-rank`}>
          Rank
          <select
            id={`${fieldId}-rank`}
            value={rankId}
            required
            disabled={busy || loadingRanks || (!ranks.length && !taxon)}
            onChange={(event) => setRankId(event.target.value)}
          >
            <option value="">{loadingRanks ? 'Loading ranks…' : 'Select rank'}</option>
            {taxon?.rankId != null && !ranks.some((rank) => rank.id === taxon.rankId) && (
              <option value={taxon.rankId}>{taxon.rank || `Rank ${taxon.rankId}`}</option>
            )}
            {ranks.map((rank) => (
              <option key={rank.id} value={rank.id}>
                {rank.name}
              </option>
            ))}
          </select>
        </label>
        {!loadingRanks && !ranks.length && (
          <div className={styles.actions}>
            <p role="alert" className={styles.error}>
              {rankError || 'No ranks were returned.'}
            </p>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setRankError('');
                setLoadingRanks(true);
              }}
              disabled={busy}
            >
              Retry ranks
            </button>
          </div>
        )}
        <label className={styles.field} htmlFor={`${fieldId}-status`}>
          Taxonomic status
          <select
            id={`${fieldId}-status`}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            disabled={busy}
          >
            {[...acceptedStatuses, ...synonymStatuses].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            {![...acceptedStatuses, ...synonymStatuses].includes(initialStatus) && (
              <option value={initialStatus}>{initialStatus}</option>
            )}
          </select>
        </label>
        {synonym ? (
          <TaxonPicker
            key="accepted"
            apiUrl={apiUrl}
            label="Accepted name"
            value={accepted}
            onSelect={setAccepted}
            exclude={taxon?.tid}
            filter={acceptedNode}
            disabled={busy}
          />
        ) : (
          <TaxonPicker
            key="parent"
            apiUrl={apiUrl}
            label="Parent taxon"
            value={parent}
            onSelect={setParent}
            exclude={taxon?.tid}
            filter={acceptedNode}
            disabled={busy}
          />
        )}
        <label className={styles.field} htmlFor={`${fieldId}-kingdom`}>
          Kingdom
          {' '}
          <input
            id={`${fieldId}-kingdom`}
            value={kingdomName}
            onChange={(event) => setKingdomName(event.target.value)}
            maxLength={45}
            placeholder="Inherit from classification"
            disabled={busy}
          />
        </label>
        <label className={styles.field} htmlFor={`${fieldId}-source`}>
          Source
          {' '}
          <input
            id={`${fieldId}-source`}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            maxLength={500}
            disabled={busy}
          />
        </label>
        <label className={styles.field} htmlFor={`${fieldId}-source-id`}>
          Source identifier
          {' '}
          <input
            id={`${fieldId}-source-id`}
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            maxLength={150}
            disabled={busy}
          />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.primary}
            disabled={busy || !name.trim() || !rankId || (synonym && !accepted)}
          >
            {busy ? 'Saving…' : 'Save taxon'}
          </button>
        </div>
      </form>
    </EditorDialog>
  );
}

interface RemapProps {
  apiUrl: string;
  csrfToken: string;
  taxon: BiorepoTaxon;
  onClose: () => void;
}

interface AcceptedLinksProps extends RemapProps {
  onChanged: (taxon: BiorepoTaxon) => void;
}

export function AcceptedLinksDialog({
  apiUrl,
  csrfToken,
  taxon,
  onClose,
  onChanged,
}: AcceptedLinksProps) {
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const links = taxon.acceptedLinks ?? [];

  async function update(acceptedTid: number, add: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await write<Omit<BiorepoTaxon, 'id'>>(
        apiUrl,
        csrfToken,
        add ? 'add-accepted-link' : 'remove-accepted-link',
        {
          tid: taxon.tid,
          acceptedTid,
        },
      );
      onChanged({ ...result, id: result.tid });
      setTarget(null);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorDialog title={`Accepted names for ${taxon.name}`} busy={busy} onClose={onClose}>
      <div className={styles.form}>
        <ul className={styles.datasetList}>
          {links.map((link) => (
            <li className={styles.actions} key={link.tid}>
              <span>
                {link.name}
                {' '}
                <span className={styles.muted}>
                  {link.primary ? 'Primary' : link.status}
                </span>
              </span>
              {!link.primary && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => update(link.tid, false)}
                >
                  Remove link
                </button>
              )}
            </li>
          ))}
        </ul>
        <TaxonPicker
          apiUrl={apiUrl}
          label="Additional accepted name"
          value={target}
          onSelect={setTarget}
          exclude={taxon.tid}
          filter={(node) => acceptedNode(node) && !links.some((link) => link.tid === node.tid)}
          disabled={busy}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            className={styles.primary}
            disabled={!target || busy}
            onClick={() => {
              if (target) update(target.tid, true);
            }}
          >
            Add accepted link
          </button>
        </div>
      </div>
    </EditorDialog>
  );
}

interface RemapBatch {
  updated: number;
  nextCursor: number | null;
  done: boolean;
}

export function RemapDialog({
  apiUrl, csrfToken, taxon, onClose,
}: RemapProps) {
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [unassigned, setUnassigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const stopAfterBatch = useRef(false);
  const updateNames = !unassigned && target?.tid === taxon.tid;

  async function remap() {
    if (!target || busy || done) return;
    setError('');
    setBusy(true);
    stopAfterBatch.current = false;
    try {
      let nextCursor = cursor;
      while (!stopAfterBatch.current) {
        // Each batch starts after the cursor returned by the previous batch.
        // eslint-disable-next-line no-await-in-loop
        const result: RemapBatch = await write<RemapBatch>(apiUrl, csrfToken, 'remap', {
          mode: unassigned ? 'unassigned' : 'remap',
          fromTid: unassigned ? undefined : taxon.tid,
          toTid: target.tid,
          cursor: nextCursor,
          limit: 500,
        });
        setUpdated((count) => count + result.updated);
        if (result.done) {
          setDone(true);
          break;
        }
        if (result.nextCursor === null || result.nextCursor === nextCursor) {
          throw new Error('Remapping paused because the server returned no progress.');
        }
        nextCursor = result.nextCursor;
        setCursor(nextCursor);
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  let actionLabel = 'Remap specimens';
  if (unassigned) actionLabel = 'Link unassigned specimens';
  else if (updateNames) actionLabel = 'Update specimen names';
  if (cursor !== null) actionLabel = 'Continue';
  if (busy) actionLabel = 'Updating specimens…';

  return (
    <EditorDialog
      title={`Specimen links for ${taxon.name}`}
      busy={busy}
      onClose={onClose}
    >
      <div className={styles.form}>
        <TaxonPicker
          apiUrl={apiUrl}
          label="Map specimens to"
          value={target}
          onSelect={(node) => { setTarget(node); setUnassigned(false); }}
          exclude={taxon.tid}
          filter={placed}
          disabled={busy || cursor !== null || done}
        />
        {placed(taxon) && !target && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => setTarget(taxon)}
            >
              Use current taxon
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={busy}
              onClick={() => {
                setTarget(taxon);
                setUnassigned(true);
              }}
            >
              Use exact name on unassigned specimens
            </button>
          </div>
        )}
        {target && !done && unassigned && (
          <p>
            Link specimens with no interpreted taxon whose name exactly matches
            {target.name}
            .
          </p>
        )}
        {target
          && !done
          && !unassigned
          && (updateNames ? (
            <p>
              Update scientific name, authorship, and family on specimens linked to
              {' '}
              <strong>{taxon.name}</strong>
              .
            </p>
          ) : (
            <p>
              Move specimen links from
              {' '}
              <strong>{taxon.name}</strong>
              {' '}
              to
              {' '}
              <strong>{target.name}</strong>
              .
            </p>
          ))}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {(busy || done || updated > 0) && (
          <p role="status">
            {updated.toLocaleString()}
            {' '}
            {unassigned ? 'specimen links added' : 'specimen links remapped'}
            {done ? '.' : ' so far.'}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={!target || busy || done}
            onClick={() => remap()}
          >
            {actionLabel}
          </button>
          {busy && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                stopAfterBatch.current = true;
              }}
            >
              Pause after this batch
            </button>
          )}
        </div>
      </div>
    </EditorDialog>
  );
}
