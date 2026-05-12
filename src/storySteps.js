export const storySteps = [
  {
    id: 'uneven-amazon',
    title: 'The Amazon is not uniform',
    mode: 'overview',
    toggle: 'Warming',
    body: [
      'Gatti et al. (2021) found that carbon-source behavior is spatially uneven, with stronger signals in eastern and southeastern Amazonia where deforestation, warming, and moisture stress coincide.',
      'This scrollytelling view uses gridded CMIP6 variables to explore related land-climate-carbon patterns. It does not reproduce the paper’s aircraft CO₂ flux estimates.'
    ]
  },
  {
    id: 'land-conversion',
    title: 'Land conversion spreads unevenly',
    mode: 'land',
    toggle: 'Land conversion',
    body: [
      'Land conversion is treated as a land-surface disturbance that co-occurs with climate stress, not as a simple direct accounting of biomass lost and carbon uptake lost.',
      'Cells with stronger crop and pasture expansion reveal where disturbance is concentrated across the modeled Amazon grid.'
    ]
  },
  {
    id: 'warming-overlap',
    title: 'Cropland expansion overlaps with warming',
    mode: 'bivariate',
    toggle: 'Warming',
    body: [
      'The paper links deforested and eastern regions with stronger warming. Here, the bivariate map asks whether modeled cells with more land conversion also show stronger warming.',
      'Darker purple cells indicate places where the two pressures coincide.'
    ]
  },
  {
    id: 'dry-season-stress',
    title: 'The dry season intensifies stress',
    mode: 'smallMultiples',
    toggle: 'Dry-season stress',
    body: [
      'Warming is most damaging when paired with water limitation. Dry-season precipitation, soil moisture, and humidity changes expose moisture stress that annual averages can hide.',
      'The linked small multiples keep the same grid while changing which dry-season stress signal is emphasized.'
    ]
  },
  {
    id: 'evaporative-cooling',
    title: 'Evaporative cooling weakens',
    mode: 'evaporation',
    toggle: 'Dry-season stress',
    body: [
      'Forested surfaces recycle moisture through evapotranspiration. When evapotranspiration weakens, less energy goes into latent cooling and hotter, drier stress can intensify.',
      'This step bridges land conversion and regional climate stress without relying on the direct biomass-loss pathway.'
    ]
  },
  {
    id: 'vegetation-response',
    title: 'Vegetation response weakens under stress',
    mode: 'scatter',
    toggle: 'Vegetation response',
    body: [
      'The concern is not just hotter land; it is a stressed ecosystem with weaker vegetation function and weaker carbon uptake.',
      'In the modeled data, hotter and drier cells are associated with weaker productivity response where points fall lower on the scatterplot.'
    ]
  },
  {
    id: 'carbon-fragility',
    title: 'Carbon uptake turns fragile',
    mode: 'risk',
    toggle: 'Carbon fragility',
    body: [
      'The strongest danger zones are where land conversion, warming, drying, weakened evaporative cooling, weaker productivity, and weaker carbon uptake overlap.',
      'This synthesis is consistent with the climate-stress mechanism described by Gatti et al.; it does not prove causality from CMIP6 output alone.'
    ]
  }
];

export const toggles = [
  'Land conversion',
  'Warming',
  'Dry-season stress',
  'Vegetation response',
  'Carbon fragility'
];
