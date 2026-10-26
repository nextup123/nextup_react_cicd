import { normDtype, uid, validateValue } from '../../lib/format';

export const STATUS = {
  draft: { label: 'Draft', badge: 'badge-outline' },
  ready: { label: 'Ready', badge: 'badge-ok' },
  locked: { label: 'Locked', badge: 'badge-warn' },
};

/** Fill in fields older recipe.json files may not have. */
export function normaliseRecipe(r) {
  const now = new Date().toISOString();
  return {
    ...r,
    name: typeof r.name === 'string' ? r.name : 'Untitled recipe',
    description: r.description || '',
    purpose: r.purpose || '',
    notes: r.notes || '',
    author: r.author || '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: STATUS[r.status] ? r.status : 'draft',
    // Drives this recipe may run on (positions). null = every drive; recipes
    // saved before v3.4 have no list and stay allowed everywhere.
    drives: normDrives(r.drives),
    blocks: (Array.isArray(r.blocks) ? r.blocks : []).map((b) => ({
      ...b,
      type: b.type === 'get' ? 'get' : 'set',
      value: b.value ?? 0,
      delay: Number(b.delay) >= 0 ? Number(b.delay) : 1000,
      expectedValue: b.expectedValue ?? '',
      storeAs: b.storeAs ?? '',
    })),
    executionCount: r.executionCount || 0,
    lastExecutedAt: r.lastExecutedAt || null,
    createdAt: r.createdAt || now,
    modifiedAt: r.modifiedAt || now,
  };
}

function normDrives(d) {
  if (!Array.isArray(d)) return null;
  const list = [...new Set(d.map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
  return list.length ? list : null;
}

/** Is this drive position allowed for the recipe? */
export const driveAllowed = (recipe, pos) => !Array.isArray(recipe.drives) || recipe.drives.includes(pos);

export function newRecipe(count) {
  const now = new Date().toISOString();
  return normaliseRecipe({
    id: uid('recipe'),
    name: `Recipe ${count + 1}`,
    status: 'draft',
    blocks: [],
    createdAt: now,
    modifiedAt: now,
  });
}

export function blockFromPreset(p) {
  return {
    _key: uid('b'),
    type: p.readOnly ? 'get' : 'set',
    index: p.index,
    subindex: p.subindex,
    name: p.name,
    dataType: normDtype(p.dataType ?? p.data_type),
    value: p.defaultValue ?? 0,
    delay: 1000,
    expectedValue: '',
    storeAs: '',
  };
}

export function withKeys(recipe) {
  return { ...recipe, blocks: recipe.blocks.map((b) => ({ ...b, _key: b._key || uid('b') })) };
}

export function stripKeys(recipe) {
  return { ...recipe, blocks: recipe.blocks.map(({ _key, ...b }) => b) };
}

/** Returns a list of human-readable problems; empty when the draft can be saved. */
export function validateRecipe(r) {
  const problems = [];
  if (!r.name.trim()) problems.push('Recipe name is required');
  if (Array.isArray(r.drives) && r.drives.length === 0) problems.push('Choose at least one drive this recipe can run on');
  r.blocks.forEach((b, i) => {
    if (b.type === 'set') {
      const err = validateValue(b.value, b.dataType);
      if (err) problems.push(`Step ${i + 1} (${b.name}): ${err}`);
    }
    if (!(Number(b.delay) >= 0)) problems.push(`Step ${i + 1}: delay must be 0 or more`);
  });
  return problems;
}
