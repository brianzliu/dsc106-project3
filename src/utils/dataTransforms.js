import { geoArea } from 'd3';

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function reverseRing(ring) {
  return [...ring].reverse();
}

function reverseGeometry(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(reverseRing)
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map(reverseRing))
    };
  }
  return geometry;
}

export function normalizeGeometry(geometry) {
  if (!geometry) return geometry;
  const feature = { type: 'Feature', properties: {}, geometry };
  return geoArea(feature) > Math.PI * 2 ? reverseGeometry(geometry) : geometry;
}

export function combineLandConversion(row) {
  const existing = finiteNumber(row.land_conversion_change);
  if (existing !== null) return existing;
  const crop = finiteNumber(row.crop_change) ?? 0;
  const pasture = finiteNumber(row.pasture_change) ?? 0;
  return crop + pasture;
}

export function zscore(values) {
  const clean = values.map(finiteNumber).filter((value) => value !== null);
  if (!clean.length) return values.map(() => null);
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  const deviation = Math.sqrt(variance);
  return values.map((value) => {
    const number = finiteNumber(value);
    if (number === null) return null;
    return deviation === 0 ? 0 : (number - mean) / deviation;
  });
}

function addZComponent(rows, key, accessor) {
  const scores = zscore(rows.map(accessor));
  rows.forEach((row, index) => {
    row.__components[key] = scores[index];
  });
}

function componentSum(row, keys, minComponents = 1) {
  const values = keys.map((key) => finiteNumber(row.__components[key])).filter((value) => value !== null);
  if (values.length < minComponents) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function computeWarmingScore(rows) {
  addZComponent(rows, 'warming', (row) => finiteNumber(row.tas_change) ?? finiteNumber(row.tasmax_change));
  rows.forEach((row) => {
    row.warming_score = finiteNumber(row.warming_score) ?? row.__components.warming;
  });
  return rows;
}

export function computeDrynessScore(rows) {
  addZComponent(rows, 'dry_pr', (row) => {
    const value = finiteNumber(row.pr_dry_change);
    return value === null ? null : -value;
  });
  addZComponent(rows, 'dry_mrsos', (row) => {
    const value = finiteNumber(row.mrsos_dry_change);
    return value === null ? null : -value;
  });
  const hasHumidity = rows.some((row) => finiteNumber(row.hurs_dry_change) !== null);
  if (hasHumidity) {
    addZComponent(rows, 'dry_hurs', (row) => {
      const value = finiteNumber(row.hurs_dry_change);
      return value === null ? null : -value;
    });
  }
  const keys = hasHumidity ? ['dry_pr', 'dry_mrsos', 'dry_hurs'] : ['dry_pr', 'dry_mrsos'];
  rows.forEach((row) => {
    row.dryness_score = finiteNumber(row.dryness_score) ?? componentSum(row, keys, Math.min(2, keys.length));
  });
  return rows;
}

export function computeClimateStressScore(rows) {
  addZComponent(rows, 'warming_score_z', (row) => finiteNumber(row.warming_score));
  addZComponent(rows, 'dryness_score_z', (row) => finiteNumber(row.dryness_score));
  const hasEvap = rows.some((row) => finiteNumber(row.evspsbl_change) !== null);
  if (hasEvap) {
    addZComponent(rows, 'evap_weakening', (row) => {
      const value = finiteNumber(row.evspsbl_change);
      return value === null ? null : -value;
    });
  }
  const keys = hasEvap ? ['warming_score_z', 'dryness_score_z', 'evap_weakening'] : ['warming_score_z', 'dryness_score_z'];
  rows.forEach((row) => {
    row.climate_stress_score = finiteNumber(row.climate_stress_score) ?? componentSum(row, keys, Math.min(2, keys.length));
  });
  return rows;
}

export function computeProductivityResponseScore(rows) {
  addZComponent(rows, 'gpp_weakening', (row) => {
    const value = finiteNumber(row.gpp_change);
    return value === null ? null : -value;
  });
  addZComponent(rows, 'lai_weakening', (row) => {
    const value = finiteNumber(row.lai_change);
    return value === null ? null : -value;
  });
  rows.forEach((row) => {
    row.productivity_response_score = finiteNumber(row.productivity_response_score) ?? componentSum(row, ['gpp_weakening', 'lai_weakening'], 1);
  });
  return rows;
}

export function computeCarbonFragilityScore(rows) {
  addZComponent(rows, 'land_conversion', (row) => finiteNumber(row.land_conversion_change));
  addZComponent(rows, 'fragile_warming', (row) => finiteNumber(row.tas_change) ?? finiteNumber(row.tasmax_change));
  addZComponent(rows, 'fragile_pr', (row) => {
    const value = finiteNumber(row.pr_dry_change);
    return value === null ? null : -value;
  });
  addZComponent(rows, 'fragile_mrsos', (row) => {
    const value = finiteNumber(row.mrsos_dry_change);
    return value === null ? null : -value;
  });
  addZComponent(rows, 'fragile_evspsbl', (row) => {
    const value = finiteNumber(row.evspsbl_change);
    return value === null ? null : -value;
  });
  addZComponent(rows, 'fragile_gpp_or_lai', (row) => {
    const value = finiteNumber(row.gpp_change) ?? finiteNumber(row.lai_change);
    return value === null ? null : -value;
  });
  addZComponent(rows, 'fragile_nbp', (row) => {
    const value = finiteNumber(row.nbp_change);
    return value === null ? null : -value;
  });
  const keys = ['land_conversion', 'fragile_warming', 'fragile_pr', 'fragile_mrsos', 'fragile_evspsbl', 'fragile_gpp_or_lai', 'fragile_nbp'];
  rows.forEach((row) => {
    row.carbon_fragility_score = finiteNumber(row.carbon_fragility_score) ?? componentSum(row, keys, 3);
  });
  return rows;
}

export function prepareRows(rawRows) {
  const rows = rawRows
    .filter((row) => finiteNumber(row.lat) !== null && finiteNumber(row.lon) !== null && row.geometry)
    .map((row, index) => ({
      ...row,
      cell_id: row.cell_id ?? `cell-${index}`,
      lat: finiteNumber(row.lat),
      lon: finiteNumber(row.lon),
      geometry: normalizeGeometry(row.geometry),
      land_conversion_change: combineLandConversion(row),
      __components: {}
    }));

  computeWarmingScore(rows);
  computeDrynessScore(rows);
  computeClimateStressScore(rows);
  computeProductivityResponseScore(rows);
  computeCarbonFragilityScore(rows);

  return rows;
}
