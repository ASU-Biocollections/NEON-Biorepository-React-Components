export interface EditorNode {
  id: number | string;
  name: string;
  author?: string | null;
  rank?: string | null;
  status?: string | null;
  hasChildren?: boolean;
}

export interface BiorepoTaxon extends EditorNode {
  id: number;
  tid: number;
  rankId: number | null;
  kingdomName?: string | null;
  parentTid?: number | null;
  acceptedTid?: number | null;
  acceptedLinks?: { tid: number; name: string; status?: string; primary: boolean }[];
  source?: string | null;
  sourceId?: string | null;
  editorialOverride?: boolean;
}

export interface SourceDataset {
  datasetKey: string;
  label: string;
  version?: string | null;
}

export interface Sector extends SourceDataset {
  rootTid: number;
  rootName?: string;
  sourceRootId?: string | null;
  updatedAt?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

type Params = Record<string, number | string | undefined | null>;

async function request<T>(url: URL, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object' || 'error' in payload) {
    throw new Error(payload?.error ?? `Request failed (${response.status}).`);
  }
  if (!('data' in payload)) throw new Error('The server returned an unexpected response.');
  return payload.data as T;
}

export function read<T>(apiUrl: string, action: string, fields: Params = {}) {
  const url = new URL(apiUrl, window.location.href);
  url.searchParams.set('action', action);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return request<T>(url);
}

export function write<T>(
  apiUrl: string,
  csrfToken: string,
  action: string,
  fields: object,
) {
  const url = new URL(apiUrl, window.location.href);
  url.searchParams.set('action', action);
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ ...fields, action }),
  });
}

function asEditorTaxon(taxon: Omit<BiorepoTaxon, 'id'>): BiorepoTaxon {
  return { ...taxon, id: taxon.tid };
}

export async function readTaxa(apiUrl: string, action: 'tree' | 'search', fields: Params) {
  const result = await read<Page<Omit<BiorepoTaxon, 'id'>>>(apiUrl, action, {
    ...fields,
    scope: action === 'search' ? 'all' : undefined,
  });
  return { ...result, items: result.items.map(asEditorTaxon) };
}

export async function readTaxon(apiUrl: string, tid: number) {
  const taxon = await read<Omit<BiorepoTaxon, 'id'>>(apiUrl, 'taxon', {
    tid,
    scope: 'all',
  });
  return asEditorTaxon(taxon);
}

export function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
