export const storySteps = [
  {
    id: 'sink-then-now',
    shortLabel: 'Then → now',
    title: 'A carbon sink under pressure',
    period: '1850 → 2014',
    mode: 'sinkTransition',
    focus: null,
    annotation: {
      title: 'A sink turning into a source',
      detail: 'Cells outlined in red have flipped from absorbing carbon in 1850 to releasing it by 2014.'
    },
    body: [
      'For a long time, the Amazon has done us a <strong>massive favor</strong>: it breathes in more carbon pollution than it breathes out. But that favor is <strong>slipping</strong>.',
      'This first map shows where the forest is crossing a dangerous line. The <strong>highlighted areas</strong> are places where that balance has flipped — they used to absorb carbon, but now they release it.'
    ]
  },
  {
    id: 'land-conversion',
    shortLabel: 'Land conversion',
    title: 'The land surface changes first',
    mode: 'land',
    period: 'comparison',
    focus: { regions: ['southeast', 'southwest'], label: 'Arc of deforestation' },
    annotation: {
      title: 'The arc of deforestation',
      detail: 'Crop and pasture expansion sweeps across southern and southeastern Amazonia first.'
    },
    body: [
      'To understand why the forest is struggling, look at <strong>the land itself</strong>. Across the basin, trees are being replaced by <strong>crops and cattle</strong>.',
      'About <strong>17% of the Amazon has been cleared</strong> so far, and the vast majority of that land is now <strong>pasture</strong>.',
      'But this clearing isn\'t even. The <strong>eastern half</strong> of the basin has been heavily chopped down, while the <strong>west is mostly untouched</strong>. This physical reshaping of the land is the <strong>first domino to fall</strong>.'
    ]
  },
  {
    id: 'warming-overlap',
    shortLabel: 'Warming overlap',
    title: 'Converted places also grow hotter',
    mode: 'bivariate',
    period: 'comparison',
    focus: { regions: ['southeast'], label: 'Southeastern Amazonia', zoomToFocus: false },
    annotation: {
      title: 'Land change meets warming',
      detail: 'The deepest red cells in the southeast carry both stressors at once — strong conversion and strong warming.'
    },
    body: [
      'When you chop down a cooling forest canopy and replace it with open pasture, the <strong>land heats up</strong>.',
      'This map shows where deforestation and <strong>extreme warming pile up</strong> on top of each other.',
      'While the whole basin is getting slightly warmer, the dry season tells a <strong>much harsher story</strong>. In the heavily cleared east, temperatures during the hottest, driest months have spiked by <strong>over 3 °C (about 5.5 °F)</strong> — a massive jump that shocks the local ecosystem.'
    ]
  },
  {
    id: 'dry-season-stress',
    shortLabel: 'Dry stress',
    title: 'The dry season intensifies the strain',
    mode: 'smallMultiples',
    period: 'comparison',
    focus: { regions: ['southeast'], label: 'Southeastern Amazonia' },
    annotation: {
      title: 'A harsher dry season',
      detail: 'The same arc loses precipitation, soil moisture, and humidity together when warming hits.'
    },
    body: [
      'Heat alone doesn\'t break a forest. The real danger happens when <strong>hot weather hits during the dry season</strong>, when water is already scarce.',
      'Looking at <strong>rainfall, soil moisture, and humidity</strong> side-by-side shows how a warmer climate quickly turns into a <strong>survival test for the ecosystem</strong>.'
    ]
  },
  {
    id: 'evaporative-cooling',
    shortLabel: 'Cooling weakens',
    title: 'The forest loses part of its buffer',
    mode: 'evaporation',
    period: 'comparison',
    focus: { regions: ['southeast'], label: 'Southeastern Amazonia' },
    annotation: {
      title: 'The buffer fails',
      detail: 'Evapotranspiration weakens exactly where forest has been replaced — the cooling feedback breaks.'
    },
    body: [
      'A healthy Amazon acts like a <strong>giant air conditioner</strong>. Trees release water vapor, cooling the air and creating rain that is blown further west. This incredible <strong>\'flying river\'</strong> supplies up to <strong>a third of the region\'s rainfall</strong>.',
      'But as the eastern forests are cleared, this <strong>rain machine breaks down</strong>. Dry-season rain has dropped significantly across the board — even in the mostly untouched west.',
      'At the same time, the hotter, drier air acts like a <strong>sponge, sucking the remaining moisture right out of the leaves</strong>. This is the <strong>tipping point</strong> where land clearing and dry weather start making each other worse.'
    ]
  },
  {
    id: 'vegetation-response',
    shortLabel: 'Vegetation',
    title: 'Vegetation productivity starts to slip',
    mode: 'scatter',
    period: 'comparison',
    focus: null,
    annotation: null,
    body: [
      'Each dot is one Amazon grid cell. <strong>Moving right</strong> means the cell experienced <strong>stronger combined climate stress</strong>: more warming, more dry-season drying, and weaker evaporative cooling where available.',
      '<strong>Moving down</strong> along the vertical axis means <strong>GPP change turns negative or stalls</strong> (weaker uptake between periods compared with cells plotted higher). The <strong>lower-right</strong> quadrant — high stress paired with weaker productivity — sits where both patterns meet.',
      'The pattern is not meant to prove that climate stress alone caused the change in GPP. Instead, it shows whether the CMIP6 data are <strong>consistent with the mechanism</strong> described in the paper: <strong>hotter, drier regions</strong> tend to be where the forest’s carbon uptake becomes <strong>more fragile</strong>.'
    ]
  },
  {
    id: 'carbon-fragility',
    shortLabel: 'Fragility map',
    title: 'Where the sink becomes fragile',
    mode: 'risk',
    period: 'comparison',
    focus: null,
    annotation: {
      title: 'Where the sink breaks',
      detail: 'The brightest cells stack land change, warming, drying, and productivity loss in the same place.'
    },
    body: [
      'In the final view, we put all the pieces together: where is the land being <strong>cleared, heated up, dried out, and losing its health all at once</strong>?',
      'These <strong>red-alert zones</strong> are where the Amazon\'s carbon sink is the <strong>most fragile</strong>, and most likely to <strong>tip the wrong way permanently</strong>.',
      'The east-west split is clear, but the danger is <strong>spreading</strong>. The heavily cleared east has mostly flipped to a <strong>carbon source</strong>. The wetter west is still hanging on, but dangerous <strong>hotspots are already creeping in</strong> along its edges. Worse, the <strong>west\'s survival relies on the rain-making machine in the east</strong> — and that machine is rapidly breaking down.'
    ]
  }
];
