export const storySteps = [
  {
    id: 'sink-then-now',
    shortLabel: 'Then → now',
    title: 'A carbon sink under pressure',
    mode: 'sinkTransition',
    focus: null,
    annotation: {
      title: 'A sink turning into a source',
      detail: 'Cells outlined in red have flipped from absorbing carbon in 1850 to releasing it by 2014.'
    },
    body: [
      'The story begins with a tension: the Amazon has long helped absorb carbon, but that role is becoming less secure in parts of the basin.',
      'This first map shows the net change in modeled carbon balance from 1850 to 2014. The red-outlined cells mark where the basin has flipped from carbon sink to carbon source.'
    ]
  },
  {
    id: 'land-conversion',
    shortLabel: 'Land conversion',
    title: 'The land surface changes first',
    mode: 'land',
    focus: { regions: ['southeast', 'southwest'], label: 'Arc of deforestation' },
    annotation: {
      title: 'The arc of deforestation',
      detail: 'Crop and pasture expansion sweeps across southern and southeastern Amazonia first.'
    },
    body: [
      'To understand why the carbon sink weakens, the first place to look is the land itself. Forest is being replaced unevenly by crops and pasture across the basin.',
      'These changing areas act as the first domino, showing where the landscape has already been physically transformed before the climate response comes into view.'
    ]
  },
  {
    id: 'warming-overlap',
    shortLabel: 'Warming overlap',
    title: 'Converted places also grow hotter',
    mode: 'bivariate',
    focus: { regions: ['southeast'], label: 'Southeastern Amazonia' },
    annotation: {
      title: 'Land change meets warming',
      detail: 'The deepest red cells in the southeast carry both stressors at once — strong conversion and strong warming.'
    },
    body: [
      'The next question is whether those converted places are also warming more strongly. Land-cover change is not just a change in appearance; it can reshape local climate conditions.',
      'Where land conversion and warming overlap, the story deepens: the most altered parts of the landscape are also becoming hotter.'
    ]
  },
  {
    id: 'dry-season-stress',
    shortLabel: 'Dry stress',
    title: 'The dry season intensifies the strain',
    mode: 'smallMultiples',
    focus: { regions: ['southeast'], label: 'Southeastern Amazonia' },
    annotation: {
      title: 'A harsher dry season',
      detail: 'The same arc loses precipitation, soil moisture, and humidity together when warming hits.'
    },
    body: [
      'Heat alone is not enough to explain the risk. The more important question is what happens when hotter conditions collide with the dry season, when water is already harder to hold onto.',
      'Looking across precipitation, soil moisture, and humidity shows how warming turns into ecological stress when the dry season grows harsher.'
    ]
  },
  {
    id: 'evaporative-cooling',
    shortLabel: 'Cooling weakens',
    title: 'The forest loses part of its buffer',
    mode: 'evaporation',
    focus: { regions: ['southeast'], label: 'Southeastern Amazonia' },
    annotation: {
      title: 'The buffer fails',
      detail: 'Evapotranspiration weakens exactly where forest has been replaced — the cooling feedback breaks.'
    },
    body: [
      'A healthy forest helps cool and regulate itself by returning moisture to the air. When that buffering process weakens, hotter and drier conditions can feed on themselves.',
      'This is the point where land change and dry-season stress stop looking separate and start behaving like a reinforcing system.'
    ]
  },
  {
    id: 'vegetation-response',
    shortLabel: 'Vegetation',
    title: 'Vegetation productivity starts to slip',
    mode: 'scatter',
    focus: null,
    annotation: null,
    body: [
      'Once the landscape is hotter and drier, the next question is whether the vegetation itself responds. If the ecosystem is under real stress, its productivity should begin to weaken.',
      'The scatter shifts the story from maps to evidence, showing whether the cells facing the strongest pressure are also the ones where biological performance starts to fall.'
    ]
  },
  {
    id: 'carbon-fragility',
    shortLabel: 'Fragility map',
    title: 'Where the sink becomes fragile',
    mode: 'risk',
    focus: null,
    annotation: {
      title: 'Where the sink breaks',
      detail: 'The brightest cells stack land change, warming, drying, and productivity loss in the same place.'
    },
    body: [
      'In the final view, the question becomes where all of these signals converge: land conversion, warming, dry-season stress, weaker ecosystem buffering, and declining productivity.',
      'Those overlaps mark the places where the Amazon’s carbon sink appears most vulnerable, and where the balance is most likely to tip toward fragility.'
    ]
  }
];
