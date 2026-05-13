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
      'For a long time the Amazon has done us a quiet favor: it <strong>pulls more carbon out of the air than it puts back in</strong>. That favor is now <strong>slipping in parts of the basin</strong>.',
      'This first map shows how that balance has shifted between <strong>1850 and 2014</strong>. The <strong>red-outlined cells</strong> are the places that have crossed a line — they used to <strong>absorb carbon, and now they release it</strong>.'
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
      'To see why the sink is weakening, start with <strong>the land itself</strong>. Across the basin, forest has been replaced — but not evenly. Most of the cleared land has become <strong>pasture and cropland</strong>.',
      'About <strong>17% of the Amazon</strong> has been cleared so far. Of that cleared land, roughly <strong>89% is now pasture</strong>, and another 10% grows crops.',
      'The clearing is lopsided. Nearly <strong>27% of the eastern basin</strong> has been deforested, compared with just <strong>11% in the west</strong>. The east has already been <strong>physically reshaped</strong>, long before any climate response shows up.'
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
      'Next question: are those cleared places also <strong>getting hotter faster</strong>? When you swap forest for pasture, you change more than the view — you change how the local climate behaves.',
      'The map shows where <strong>land change and warming pile up together</strong>. The most reworked parts of the landscape are also the ones <strong>heating up the most</strong>.',
      'Across the whole basin, the year-round warming is about <strong>+1.0 °C</strong> — roughly the global rate. But the <strong>dry season</strong> tells a sharper story. Over four decades, dry-season temperatures rose <strong>+1.86 °C in the northeast</strong> and <strong>+2.54 °C in the southeast</strong>. In the two hottest months of the year, the southeast warmed by a striking <strong>+3.07 °C</strong>.'
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
      'Heat alone doesn\'t break a forest. The real trouble starts when <strong>hot weather hits during the dry season</strong>, when water is already scarce.',
      'Looking at <strong>rainfall, soil moisture, and humidity</strong> side by side shows how warming turns into <strong>real stress on the ecosystem</strong> once the dry months bite harder.'
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
      'A healthy forest <strong>air-conditions itself</strong>. Leaves release water vapor, the air cools, and that moisture often falls again as rain further west. When that recycling slows, the air gets hotter and drier — and the process feeds on itself.',
      'That moisture-recycling cascade isn\'t a small effect. It supplies roughly <strong>25–35% of the Amazon\'s rainfall</strong> — a meaningful slice of the basin\'s ~2,200 mm of rain each year.',
      'As eastern forests thin out, that cascade falters far beyond just the cleared areas. Dry-season rainfall has dropped by about <strong>24% in the southeast</strong>, <strong>34% in the northeast</strong>, and even <strong>20% in the lightly cleared west</strong>. At the same time, the warmer, drier air <strong>pulls more water out of every leaf it touches</strong>. This is the moment land change and dry-season stress stop being separate problems and start <strong>reinforcing each other</strong>.'
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
      'If the landscape really is hotter and drier, the plants should start to <strong>show the strain</strong>. A stressed ecosystem doesn\'t grow as vigorously as a healthy one.',
      'One way to measure that is <strong>gross primary production</strong>, or GPP — basically <strong>how much carbon the forest pulls out of the air through photosynthesis</strong>. When GPP falls, the forest is doing less of its job.',
      'The stakes are large. An intact Amazon holds about <strong>123 billion tonnes of carbon</strong> in its trees and soils. And yet the eastern basin — only about <strong>24% of the Amazon\'s area</strong> — is already responsible for roughly <strong>72% of the basin\'s carbon emissions</strong>. About <strong>62% of those emissions come from fires</strong>.',
      'The scatter plot lets us check the link directly: are the places under the <strong>most pressure</strong> also the places where the forest\'s <strong>productivity is starting to fall</strong>?'
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
      'In the final view, every signal lands in the same picture: <strong>where has the land been cleared, warmed, dried out, lost its forest cooling, and lost productivity all at once</strong>?',
      'Those overlapping pressures point to the places where the Amazon\'s carbon sink looks <strong>most fragile</strong>, and most likely to <strong>tip the wrong way</strong>.',
      'The east-west split becomes hard to miss. Where the basin has been cleared, warmed, and dried at the same time, it has already <strong>crossed from carbon sink to carbon source</strong>. The wetter west is still hanging on — but it depends on the moisture-recycling cascade that the east can no longer keep going.'
    ]
  }
];
