const idKeys = ['datasetid', 'collid', 'clid'];
const validId = (value) => (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())
  ? value.trim() : undefined);

/** Fill query-value placeholders using the current page's IDs, never the URL fragment. */
export function resolveBreadcrumbLinks(breadcrumbs, search, pageDocument) {
  const params = new URLSearchParams(search);
  const ids = Object.fromEntries(idKeys.map((key) => {
    const values = params.getAll(key);
    const queryIds = [...new Set(values.map(validId))];
    if (queryIds.length === 1 && queryIds[0]) return [key, queryIds[0]];

    // POST forms can render the same page without keeping its ID in the address bar.
    const inputs = pageDocument?.querySelectorAll(`input[type="hidden"][name="${key}"]`) || [];
    const formIds = [...new Set(Array.from(inputs, (input) => validId(input.value)).filter(Boolean))];
    return [key, formIds.length === 1 ? formIds[0] : undefined];
  }));

  return breadcrumbs.map((breadcrumb) => {
    if (typeof breadcrumb.href !== 'string') return breadcrumb;
    let missingId = false;
    const href = breadcrumb.href.replace(
      /([?&])(datasetid|collid|clid)=(?:#|%23)(?=&|$)/gi,
      (placeholder, separator, key) => {
        const id = ids[key.toLowerCase()];
        if (!id) {
          missingId = true;
          return placeholder;
        }
        return `${separator}${key}=${id}`;
      },
    );
    // Keep the breadcrumb label, but do not create a broken parent link.
    return { ...breadcrumb, href: missingId ? undefined : href };
  });
}
