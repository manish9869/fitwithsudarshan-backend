// backend/src/data/serverPricing.js
//
// MUST stay in sync with `pricingTable` in the frontend's src/data/SiteData.js.
// This is the ONLY price the server trusts — client-submitted amounts are
// never used to charge or record a payment.
//
// ⚠️ Whenever you change a price in SiteData.js, update it here too.
// (Longer-term: extract this object into a shared JSON file both the Vite
// app and this Express backend import, so there's one source of truth.)

export const pricingTable = {
    online: {
        individual: {
            '1': 1999,
            '3': 3999,
            '6': 6999,
            '12': 15999,
        },
        couple: {
            '1': 4999,
            '3': 12999,
            '6': 22999,
            '12': 38999,
        },
        basic_individual: {
            '1': 99,
        },
        basic_couple: {
            '1': 199,
        },
    },
    video: {
        individual: {
            '1': 10000,
            '3': 28000,
            '6': 55000,
            '12': 100000,
        },
        couple: {
            '1': 18000,
            '3': 50000,
            '6': 100000,
            '12': 180000,
        },
    },
    personal: {
        individual: {
            '1': 20000,
            '3': 55000,
            '6': 105000,
            '12': 200000,
        },
        couple: {
            '1': 35000,
            '3': 70000,
            '6': 120000,
            '12': 220000,
        },
    },
};

/**
 * Resolve the authoritative price (in rupees) for a given selection.
 * Throws if the combination doesn't exist in the price table — this is
 * what stops a tampered/invalid coachingType+planType+duration combo
 * from silently resolving to `undefined` and blowing up downstream.
 */
export function resolvePrice({ coachingType, planType, durationMonths }) {
    const price = pricingTable[coachingType]?.[planType]?.[durationMonths];

    if (price == null) {
        throw new Error('Invalid coaching type, plan type, or duration combination.');
    }
    return price;
}