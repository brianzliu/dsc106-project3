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
      'The story begins with a tension: the Amazon has long helped <strong>absorb carbon</strong>, but that role is becoming <strong>less secure</strong> in parts of the basin.',
      'This first map shows the <strong>net change in modeled carbon balance</strong> from 1850 to 2014. The <strong>red-outlined cells</strong> mark where the basin has flipped from <strong>carbon sink to carbon source</strong>.'
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
      'To understand why the carbon sink weakens, the first place to look is <strong>the land itself</strong>. Forest is being replaced unevenly by <strong>crops and pasture</strong> across the basin.',
      'These changing areas act as the <strong>first domino</strong>, showing where the landscape has already been <strong>physically transformed</strong> before the climate response comes into view.'
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
      'The next question is whether those converted places are also <strong>warming more strongly</strong>. Land-cover change is not just a change in appearance; it can <strong>reshape local climate</strong> conditions.',
      'Where <strong>land conversion and warming overlap</strong>, the story deepens: the most altered parts of the landscape are also becoming <strong>hotter</strong>.'
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
      'Heat alone is not enough to explain the risk. The more important question is what happens when <strong>hotter conditions collide with the dry season</strong>, when water is already harder to hold onto.',
      'Looking across <strong>precipitation, soil moisture, and humidity</strong> shows how warming turns into <strong>ecological stress</strong> when the dry season grows harsher.'
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
      'A healthy forest helps <strong>cool and regulate itself</strong> by returning moisture to the air. When that <strong>buffering process weakens</strong>, hotter and drier conditions can feed on themselves.',
      'This is the point where land change and dry-season stress stop looking separate and start behaving like a <strong>reinforcing system</strong>.'
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
      'Once the landscape is hotter and drier, the next question is whether <strong>the vegetation itself responds</strong>. If the ecosystem is under real stress, its <strong>productivity should begin to weaken</strong>.',
      'The scatter shifts the story from maps to evidence, showing whether the cells facing the <strong>strongest pressure</strong> are also the ones where <strong>biological performance starts to fall</strong>.'
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
      'In the final view, the question becomes where <strong>all of these signals converge</strong>: land conversion, warming, dry-season stress, weaker ecosystem buffering, and declining productivity.',
      'Those overlaps mark the places where the Amazon\'s carbon sink appears <strong>most vulnerable</strong>, and where the balance is most likely to <strong>tip toward fragility</strong>.'
    ]
  }
];
