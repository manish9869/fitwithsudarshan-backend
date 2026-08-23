// src/utils/gaClient.js
// Shared GA4 Data API client — used by both gaRealtimeService.js (Realtime
// report, "live visitors right now") and gaReportService.js (standard
// historical reports: pageviews/sessions/top pages/sources/devices over a
// date range). Requires a Google Cloud service account with Viewer access
// on the GA4 property (see config.ga4 in config/env.js for the three env
// vars — GA4_PROPERTY_ID/GA4_CLIENT_EMAIL/GA4_PRIVATE_KEY).
//
// @google-analytics/data pulls in google-gax/protobufjs (a gRPC client
// stack, comparable in weight to Puppeteer) — imported dynamically below
// instead of at module top-level. This module is reachable via an eager
// import chain from every route (app.js -> routes/admin.js ->
// analyticsController.js -> here), so a top-level import loaded the whole
// gRPC stack on every cold start of the function, including public,
// non-admin requests, regardless of whether GA4 is even configured.
import { config } from '../config/env.js';

let _client = null;

export function isGa4Configured() {
    return !!(config.ga4.propertyId && config.ga4.clientEmail && config.ga4.privateKey);
}

export async function getGaClient() {
    if (!_client) {
        const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
        _client = new BetaAnalyticsDataClient({
            credentials: {
                client_email: config.ga4.clientEmail,
                private_key: config.ga4.privateKey,
            },
        });
    }
    return _client;
}

export function ga4PropertyPath() {
    return `properties/${config.ga4.propertyId}`;
}

export function assertGa4Configured() {
    if (!isGa4Configured()) {
        const err = new Error('GA4 is not configured');
        err.code = 'GA4_NOT_CONFIGURED';
        throw err;
    }
}
