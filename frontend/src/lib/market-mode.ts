// Demo is an explicit build choice; API failures never switch data sources.
export const demoMode = process.env.NEXT_PUBLIC_MARKET_MODE === 'demo'
