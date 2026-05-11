import * as d3 from 'd3';
import { feature } from 'topojson-client';

let cache = null;
const SOUTH_AMERICA_ISO = new Set([
  '076','032','068','170','152','218','254','328','600','604','740','858','862'
]);

async function loadTopoJSON() {
  if (cache) return cache;
  const topo = await d3.json('/data/countries-50m.json');
  const countries = feature(topo, topo.objects.countries);
  const land = feature(topo, topo.objects.land);
  cache = { countries, land };
  return cache;
}

export async function getSouthAmerica() {
  const { countries } = await loadTopoJSON();
  return {
    type: 'FeatureCollection',
    features: countries.features.filter((f) => SOUTH_AMERICA_ISO.has(f.id))
  };
}

export async function getLand() {
  const { land } = await loadTopoJSON();
  return land;
}
