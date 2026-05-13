# Amazon Climate-Stress Scrollytelling

This project implements an interactive D3 v7 scrollytelling visualization about Amazon land conversion, dry-season warming, moisture stress, vegetation response, and carbon-sink fragility using preprocessed CMIP6 grid data.

The scientific framing is inspired by Gatti et al. 2021, **“Amazonia as a carbon source linked to deforestation and climate change.”** The story intentionally focuses on the climate-stress mechanism emphasized by the paper: land conversion and deforestation are associated with hotter and drier regional conditions, especially in the dry season, and those stresses can weaken vegetation function and carbon uptake.

> Methods caveat: This visualization is inspired by Gatti et al. 2021 and uses CMIP6 gridded variables to explore related land-climate-carbon patterns. It does not reproduce the paper’s aircraft CO2 flux estimates.

## How to run locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```
