const formatter = (currency) => new Intl.NumberFormat("en-GB", { style: "currency", currency });

export const formatGBP = (minor) => formatter("GBP").format((Number(minor) || 0) / 100);
export const formatGHS = (minor) => formatter("GHS").format((Number(minor) || 0) / 100);
